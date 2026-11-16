import {useQueryClient} from "@tanstack/react-query";
import {Pencil} from "lucide-react";
import {type KeyboardEvent, type ReactNode, Suspense, useEffect, useRef, useState} from "react";

import {FileSaveError, loadEditableMarkdown, saveEditableMarkdown} from "../../lib/api/file-edit";
import type {EditableMarkdownTarget} from "../../lib/file-edit";
import {isMacPlatform} from "../../lib/shortcuts/match";
import {detachedSaveMessage, retryEtag, type SaveError} from "../../lib/source-save";
import {useToast} from "../toast-context";
import {CDS_BUTTON_DISABLED, CDS_BUTTON_DISABLED_FILL} from "../ui/cds-button-disabled";
import {Tooltip} from "../ui/tooltip";
import {LazyMarkdownEditor} from "./lazy-markdown-editor";
import {SaveErrorBanner} from "./save-error-banner";

type EditState =
	|
	  {
			phase: "viewing";
	  }
	|
	  {
			phase: "loading";
	  }
	|
	  {
			phase: "editing";
			/** What the editor was seeded with; kept fixed so saving never resets it. */
			initial: string;
			draft: string;
			/** The content on disk as of the last load or save, for the dirty check. */
			saved: string;
			etag: string | null;
			saving: boolean;
			/** Upstream's `$i`: the failed save the banner shows; saves stop until Discard or a retry. */
			error: SaveError | null;
			/** Bumped by Discard to remount the editor on the saved text. */
			editorKey: number;
	  };

/* Upstream's Cancel and Save are cds Buttons, so a disabled one takes its disabled look. */
const TEXT_BUTTON = `inline-flex h-6 shrink-0 cursor-pointer items-center rounded-r5 px-2 text-footnote ${CDS_BUTTON_DISABLED}`;

function isSaveShortcut(event: KeyboardEvent): boolean
{
	const mod = isMacPlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	return mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
}

function baseName(path: string): string
{
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

/**
 * Editing a plan or memory in place: Edit swaps rendered markdown for the
 * MDX editor, Save (⌘S inside the pane) writes through the file's save API
 * with the loaded version as `If-Match`, and a refused save shows upstream's
 * save banner (Discard, or Try again / Override / Save anyway). Cancel
 * (Discard once there are edits) goes back to the preview.
 */
export function useMarkdownEdit({
	path,
	target,
	fileVersion,
	onEditStart,
	onDirtyChange,
}: {
	path: string;
	target: EditableMarkdownTarget | null;
	/** When the viewer's file query last updated; a change re-reads a deleted file to flip missing to conflict. */
	fileVersion: number;
	onEditStart: (() => void) | undefined;
	onDirtyChange: ((dirty: boolean) => void) | undefined;
})
{
	const [state, setState] = useState<EditState>(
		{
			phase: "viewing",
		},
	);
	const queryClient = useQueryClient();
	const toast = useToast();
	const name = baseName(path);
	const dirty = state.phase === "editing" && state.draft !== state.saved;

	// A save that settles after its editor went away (unmount, or Cancel) toasts instead of showing the banner.
	const mounted = useRef(true);
	const editSession = useRef(0);
	useEffect(() =>
	{
		mounted.current = true;
		return () =>
		{
			mounted.current = false;
		};
	}, []);

	const onDirtyChangeRef = useRef(onDirtyChange);
	const reportedDirty = useRef(false);
	useEffect(() =>
	{
		onDirtyChangeRef.current = onDirtyChange;
	}, [onDirtyChange]);
	useEffect(() =>
	{
		if (reportedDirty.current === dirty) return;
		reportedDirty.current = dirty;
		onDirtyChangeRef.current?.(dirty);
	}, [dirty]);
	useEffect(
		() => () =>
		{
			if (reportedDirty.current) onDirtyChangeRef.current?.(false);
		},
		[],
	);

	const refresh = () =>
	{
		void queryClient.invalidateQueries(
			{
				queryKey: ["file", path],
			},
		);
		void queryClient.invalidateQueries(
			{
				predicate: (query) => query.queryKey[0] === "plans" || query.queryKey[2] === "memories",
			},
		);
	};

	const start = async () =>
	{
		if (target === null || state.phase !== "viewing") return;
		onEditStart?.();
		setState(
			{
				phase: "loading",
			},
		);
		try
		{
			const {markdown, etag} = await loadEditableMarkdown(target);
			setState(
				{
					phase: "editing",
					initial: markdown,
					draft: markdown,
					saved: markdown,
					etag,
					saving: false,
					error: null,
					editorKey: 0,
				},
			);
		}
		catch
		{
			setState(
				{
					phase: "viewing",
				},
			);
			toast(
				{
					kind: "error",
					message: `Couldn’t open ${name} for editing.`,
				},
			);
		}
	};

	/** Upstream `gS`/`_S`: an explicit save stops while the banner shows; a retry sends the banner's `If-Match`. */
	const save = async (mode: "explicit" | "retry") =>
	{
		if (target === null || state.phase !== "editing" || state.saving) return;
		const {draft, etag, error} = state;
		if (mode === "explicit" && error !== null) return;
		const ifMatch = mode === "retry" && error !== null ? retryEtag(error) : etag;
		const session = editSession.current;
		const attached = () => mounted.current && editSession.current === session;
		setState(
			{
				...state,
				saving: true,
			},
		);
		try
		{
			const nextEtag = await saveEditableMarkdown(target, draft, ifMatch);
			setState((current) =>
				current.phase === "editing"
					?
						{
							...current,
							saving: false,
							saved: draft,
							etag: nextEtag,
							error: null,
						}
					: current,
			);
			refresh();
		}
		catch (failure)
		{
			const saveError: SaveError =
				failure instanceof FileSaveError
					? failure.error
					:
						{
							kind: "writeFailed",
							etag: ifMatch,
						};
			if (!attached())
			{
				toast(
					{
						kind: "error",
						message: detachedSaveMessage(saveError, name),
					},
				);
				return;
			}
			setState((current) =>
				current.phase === "editing"
					?
						{
							...current,
							saving: false,
							error: saveError,
						}
					: current,
			);
		}
	};

	/** Upstream `cS`: back to the last saved text, still editing; ignored while a save is in flight. */
	const discard = () =>
	{
		setState((current) =>
			current.phase === "editing" && !current.saving
				?
					{
						...current,
						initial: current.saved,
						draft: current.saved,
						error: null,
						editorKey: current.editorKey + 1,
					}
				: current,
		);
	};

	// Upstream's missing → conflict flip: once the deleted file is back on disk, Override guards its new version.
	const missingEtag = state.phase === "editing" && state.error?.kind === "missing" ? state.etag : undefined;
	const seenVersion = useRef(fileVersion);
	useEffect(() =>
	{
		if (seenVersion.current === fileVersion) return;
		seenVersion.current = fileVersion;
		if (target === null || missingEtag === undefined) return;
		loadEditableMarkdown(target).then(
			({etag}) =>
			{
				if (etag === null || etag === missingEtag) return;
				setState((current) =>
					current.phase === "editing" && current.error?.kind === "missing"
						?
							{
								...current,
								error:
								{
									kind: "conflict",
									etag,
								},
							}
						: current,
				);
			},
			() => {},
		);
	}, [fileVersion, target, missingEtag]);

	const exit = () =>
	{
		editSession.current += 1;
		setState(
			{
				phase: "viewing",
			},
		);
		refresh();
	};

	const change = (markdown: string) =>
	{
		setState((current) =>
			current.phase === "editing"
				?
					{
						...current,
						draft: markdown,
					}
				: current,
		);
	};

	const handleKeyDown = (event: KeyboardEvent) =>
	{
		if (state.phase !== "editing" || !isSaveShortcut(event)) return;
		event.preventDefault();
		event.stopPropagation();
		void save("explicit");
	};

	const editButton: ReactNode =
		target === null || state.phase !== "viewing" ? null : (
			<Tooltip content="Edit">
				<button
					type="button"
					aria-label="Edit"
					onClick={() => void start()}
					className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary"
				>
					<Pencil aria-hidden="true" className="size-4" />
				</button>
			</Tooltip>
		);

	const toolbar: ReactNode =
		state.phase === "editing" ? (
			<>
				<button
					type="button"
					onClick={exit}
					className={`${TEXT_BUTTON} text-secondary hover:bg-fill-ghost-hover hover:text-primary`}
				>
					{dirty ? "Discard" : "Cancel"}
				</button>
				<button
					type="button"
					disabled={!dirty || state.saving || state.error !== null}
					onClick={() => void save("explicit")}
					className={`${TEXT_BUTTON} ${CDS_BUTTON_DISABLED_FILL} bg-fill-primary text-on-primary hover:bg-fill-primary-hover`}
				>
					Save
				</button>
			</>
		) : null;

	const editor: ReactNode =
		state.phase === "viewing" ? null : (
			<div className="p-4">
				<div className="mx-auto max-w-[860px]">
					{state.phase === "loading" ? (
						<p className="text-footnote text-t6">Loading editor…</p>
					) : (
						<Suspense fallback={<p className="text-footnote text-t6">Loading editor…</p>}>
							<LazyMarkdownEditor key={state.editorKey} markdown={state.initial} onChange={change} />
						</Suspense>
					)}
				</div>
			</div>
		);

	// Upstream `iC`: the banner shows only while the draft differs from the saved text.
	const banner: ReactNode =
		state.phase === "editing" && dirty && state.error !== null ? (
			<SaveErrorBanner
				error={state.error}
				busy={state.saving}
				inPaneHeaderLine={false}
				onDiscard={discard}
				onRetry={() => void save("retry")}
			/>
		) : null;

	return {
		editing: state.phase !== "viewing",
		editButton,
		toolbar,
		editor,
		banner,
		handleKeyDown,
	};
}
