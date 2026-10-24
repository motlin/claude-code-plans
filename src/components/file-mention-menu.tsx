import {useLayoutEffect, useRef, useState, useSyncExternalStore} from "react";
import {Folder} from "lucide-react";

import type {SessionFilesEntry} from "../lib/api/session-files";
import {fileMentionOptionId} from "./file-mention-option-id";
import {Tooltip} from "./ui/tooltip";

type FileTypeIconModule = typeof import("./file-type-icon");

// Keeps the file-type icon set out of the composer's cold load; upstream also draws a placeholder while its icon JSON
// loads. Rows read the loaded module synchronously instead of suspending, so a late load never hides the open menu.
let fileTypeIconModule: FileTypeIconModule | undefined;
let fileTypeIconLoad: Promise<FileTypeIconModule> | undefined;
const fileTypeIconListeners = new Set<() => void>();

/** Starts loading the mention rows' file-type icons; the composer calls it on mount so the first `@` already has them. */
export async function preloadFileTypeIcons(): Promise<FileTypeIconModule> {
	fileTypeIconLoad ??= import("./file-type-icon").then((module) => {
		fileTypeIconModule = module;
		for (const listener of fileTypeIconListeners) listener();
		return module;
	});
	return fileTypeIconLoad;
}

function subscribeFileTypeIcons(listener: () => void): () => void {
	fileTypeIconListeners.add(listener);
	void preloadFileTypeIcons();
	return () => {
		fileTypeIconListeners.delete(listener);
	};
}

const loadedFileTypeIcons = () => fileTypeIconModule;

const POPUP_CLASS =
	"absolute bottom-full left-0 z-[130] mb-2 flex max-h-[min(24rem,calc(100svh-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-r7 bg-[var(--menu-bg)] p-1 text-body text-primary shadow-[var(--menu-shadow)] select-none";

const ROW_CLASS =
	"flex h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-r5 px-2 py-[2.5px] text-left text-[13px]/[19px] text-primary outline-none data-[highlighted]:bg-fill-ghost-hover";

/** Upstream's row tooltip text: the full path (directories keep their trailing `/`) with a ZWSP after every `/`. */
function mentionTooltip(entry: SessionFilesEntry): string {
	return `${entry.relPath}${entry.isDirectory ? "/" : ""}`.replaceAll("/", "/\u200B");
}

function EntryIcon({entry, icons}: {entry: SessionFilesEntry; icons: FileTypeIconModule | undefined}) {
	if (entry.isDirectory) return <Folder aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />;
	if (icons === undefined) return <span aria-hidden="true" className="size-4 shrink-0" />;
	return <icons.FileTypeIcon fileName={entry.name} size="sm" />;
}

/**
 * The claude.ai/code "@" popup: a "Mention suggestions" listbox above the
 * composer, 560px wide when any row has a dirname caption and 420px otherwise, one row per path (icon, basename, dirname caption). Keyboard focus
 * stays in the editor, which drives `highlighted` (the keyboard index) and `onAccept`. Like upstream, the pointer keeps
 * its own hover index that wins while it is over a row and falls back to the keyboard index when it leaves the list.
 */
export function FileMentionMenu({
	id,
	entries,
	highlighted,
	onAccept,
}: {
	id: string;
	entries: readonly SessionFilesEntry[];
	highlighted: number;
	onAccept: (entry: SessionFilesEntry) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const icons = useSyncExternalStore(subscribeFileTypeIcons, loadedFileTypeIcons, loadedFileTypeIcons);
	// Tied to the entries it was set against, so a new result list drops a stale hover.
	const [hover, setHover] = useState<{entries: readonly SessionFilesEntry[]; index: number} | null>(null);
	const shown = hover?.entries === entries ? hover.index : highlighted;

	useLayoutEffect(() => {
		listRef.current?.querySelector<HTMLElement>("[data-highlighted]")?.scrollIntoView({block: "nearest"});
	}, [shown, entries]);

	return (
		// oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the composer textarea keeps focus and drives the list through aria-activedescendant
		<div
			ref={listRef}
			id={id}
			role="listbox"
			aria-label="Mention suggestions"
			className={POPUP_CLASS}
			style={{width: entries.some((entry) => entry.relPath.includes("/")) ? 560 : 420}}
			onMouseDown={(e) => {
				e.preventDefault();
			}}
			onMouseLeave={() => {
				setHover(null);
			}}
		>
			{entries.map((entry, index) => {
				const slash = entry.relPath.lastIndexOf("/");
				const dirname = slash === -1 ? "" : entry.relPath.slice(0, slash);
				return (
					<Tooltip
						key={entry.relPath}
						content={mentionTooltip(entry)}
						side="right"
						delay={200}
						sideOffset={8}
						multiline={dirname !== ""}
						maxWidth={dirname === "" ? undefined : "max-w-[360px]"}
						portal
						className="w-full min-w-0"
					>
						<button
							type="button"
							tabIndex={-1}
							id={fileMentionOptionId(id, index)}
							role="option"
							data-option-index={index}
							aria-selected={index === shown}
							data-highlighted={index === shown ? "" : undefined}
							className={ROW_CLASS}
							onMouseEnter={() => {
								setHover({entries, index});
							}}
							onMouseDown={(e) => {
								e.preventDefault();
								onAccept(entry);
							}}
						>
							<EntryIcon entry={entry} icons={icons} />
							<span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-start">
								<span
									className={
										dirname === ""
											? "truncate text-primary"
											: "truncate text-primary max-w-full shrink-0"
									}
								>
									<bdi>{entry.name}</bdi>
								</span>
								{dirname !== "" && (
									<span className="truncate text-[11px]/[17px] text-ink-muted">
										<bdi>{dirname}</bdi>
									</span>
								)}
							</span>
						</button>
					</Tooltip>
				);
			})}
		</div>
	);
}
