import {useQueryClient} from "@tanstack/react-query";
import {Ellipsis} from "lucide-react";
import {type KeyboardEvent, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";

import {useSessionArchive} from "../hooks/use-session-archive";
import type {ArtifactSummary} from "../lib/api/artifacts";
import {artifactTimestamp} from "../lib/artifact-gallery";
import {toggleArtifactPin, useArtifactPins} from "../lib/artifact-pins";
import {copyLink} from "../lib/copy-link";
import {RENAME_FAILED_MESSAGE} from "../hooks/use-session-rename";
import {useRenameSessionMutation} from "../lib/api/sessions";
import {assertNever} from "../lib/assert-never";
import {pin, unpin, usePins} from "../lib/pin-store";
import {relativeBucket} from "../lib/search-text";
import {copySessionLink, sessionUrl} from "../lib/session-open-in";
import
{
	getSessionMenuItems,
	type SessionMenuCapability,
	type SessionMenuItemId,
	sessionMenuReadState,
} from "../lib/session-menu-items";
import type {SessionBucket} from "../lib/session-state";
import {ackedAt, useAwaitingAckVersion} from "../lib/awaiting-ack-store";
import {markCompleted} from "../lib/mark-completed";
import {completedAckAt, isFailedUnacked} from "../lib/failed-row";
import {markSeen, markUnseen} from "../lib/unread-store";
import {type Box, CARD_OVERLAP_PX, isAltEnter, virtualAnchor} from "./palette-row-actions-geometry";
import {type PaletteThumb, useUsableThumb} from "../lib/palette-thumb-store";
import {PaletteThumbImage} from "./palette-thumb-image";
import {SessionRenameDialog} from "./session-rename-dialog";
import {useHasUnseenWork} from "./use-has-unseen-work";
import {useToast} from "./toast-context";
import {Menu, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";
import {inlineEndSide} from "./ui/menu-anchor";
import {Tooltip} from "./ui/tooltip";

/** A session row the ⌥⏎ card can act on; `archived`/`bucket` are unknown for server-only hits. */
export interface PaletteCardSession
{
	id: string;
	title: string;
	mtime: string;
	archived: boolean | undefined;
	bucket: SessionBucket | undefined;
	/** The row is blocked on its unseen failed turn; server hits leave it out. */
	unseenError?: true | undefined;
	/** When the row's last turn failed and nothing has run since; server hits leave it out. */
	failedAt?: string | undefined;
}

/** A local project row: `~/.claude/projects/<id>`. */
export interface PaletteCardProject
{
	id: string;
	name: string;
}

/** Any other row with a local URL (routine, plan, memory, file): upstream's generic card `yt` header values. */
export interface PaletteCardGeneric
{
	title: string;
	/** Upstream's kind label `wt`, e.g. "Scheduled task". */
	kindLabel: string;
	/** The relative-time bucket; upstream gives scheduled tasks none. */
	when: string | null;
	/** The row's same-origin path. */
	href: string;
}

/** The row a ⌥⏎ card acts on: a session, a local claude.ai artifact record, a local project, or any other URL row. */
export type PaletteCardTarget =
	|
	  {
			kind: "session";
			session: PaletteCardSession;
	  }
	|
	  {
			kind: "artifact";
			artifact: ArtifactSummary;
	  }
	|
	  {
			kind: "project";
			project: PaletteCardProject;
	  }
	|
	  {
			kind: "generic";
			row: PaletteCardGeneric;
	  };

type OpenItemId = "open" | "open-new-tab";

interface CardItem<Id extends string>
{
	id: Id;
	label: string;
}

/** Upstream's `at`: Open runs the row like Enter; Open in new tab follows on web. */
const OPEN_ITEMS: readonly CardItem<OpenItemId>[] = [
	{
		id: "open",
		label: "Open",
	},
	{
		id: "open-new-tab",
		label: "Open in new tab",
	},
];

/** Upstream's card header `it`: the title, then "kind · when" (either alone without the dot; neither omits the line). */
interface CardPreview
{
	title: string;
	kind: string | undefined;
	when: string | null;
}

const SHIFT_COLLISION_AVOIDANCE =
{
	side: "shift",
	align: "shift",
} as const;

/** Upstream's `Ze`: digits are ignored this long after the item list changes, so a late item isn't mis-hit. */
const ROW_ACTIONS_DIGIT_GUARD_MS = 300;

const DIGIT_KEY = /^(?:Digit|Numpad)?([1-9])$/;

/** A held key whose auto-repeats the palette swallows after the card opens or closes on its first press. */
export type RowActionsRepeatKey = "Enter" | "ArrowLeft";

export interface RowActionsCloseOptions
{
	refocus: boolean;
	swallowRepeat?: RowActionsRepeatKey;
}

interface CardProps
{
	/** The anchor box from {@link rowActionsAnchorRect}, measured once as the card opens. */
	anchorRect: Box;
	/** Opened from the shown thumb card: its offset from the card's spot, so the card morphs out of it. */
	morphFrom?:
	{
		x: number;
		y: number;
	} | null;
	/** Runs the row as Enter would. */
	onOpen: () => void;
	onClose: (options: RowActionsCloseOptions) => void;
}

/**
 * The claude.ai/code ⌘K row-actions card: a 280px compact cds Menu overlapping the receded palette's
 * inline-end edge by 44px, with the row's title, "kind · when" and items numbered 1…N. Its modal
 * backdrop eats the first click outside. ←, Esc, Tab, ⌥⏎ again or a held Enter close only the card; digits
 * ignore repeats and the first 300ms after the item list changes. Session rows get upstream's session card
 * (Rename opens a dialog over the palette, as upstream's `CodeSessionRenameDialog` does; Delete is never
 * offered), artifact rows upstream's `mt`, project rows upstream's `ct` and every other URL row upstream's
 * generic `yt`.
 */
export function PaletteRowActionsCard({
	target,
	onRename,
	screenshots = true,
	...props
}: CardProps &
{
	target: PaletteCardTarget;
	/** Opens upstream's Rename session dialog over the palette, which stays open. */
	onRename: (session: PaletteCardSession) => void;
	/** False for a phone-latched open (upstream `Ts`'s `!phone`): the artifact card has no header screenshot. */
	screenshots?: boolean;
})
{
	switch (target.kind)
	{
		case "session":
			return <SessionCard session={target.session} onRename={onRename} {...props} />;
		case "artifact":
			return <ArtifactCard artifact={target.artifact} screenshot={screenshots} {...props} />;
		case "project":
			return <ProjectCard project={target.project} {...props} />;
		case "generic":
			return <GenericCard row={target.row} {...props} />;
		default:
			return assertNever(target);
	}
}

function SessionCard({
	session,
	onOpen,
	onRename,
	onClose,
	anchorRect,
}: CardProps &
{
	session: PaletteCardSession;
	onRename: (session: PaletteCardSession) => void;
})
{
	const queryClient = useQueryClient();
	const unseen = useHasUnseenWork(session.id);
	const pins = usePins();
	const toast = useToast();
	const setArchived = useSessionArchive(session.id);
	useAwaitingAckVersion();

	const capabilities = new Set<SessionMenuCapability>(["pin", "rename", "readState", "ackAwaiting", "copyLink"]);
	if (session.archived !== undefined) capabilities.add("archive");
	const sessionItems = getSessionMenuItems(
		{
			title: session.title,
			pinned: pins.isPinned(session.id),
			readState: sessionMenuReadState(
				session.bucket,
				unseen,
				{
					unseenError: session.unseenError === true,
					archived: session.archived ?? false,
				},
			),
			unread: unseen,
			failed: isFailedUnacked(
				{
					failedAt: session.failedAt,
					mtime: session.mtime,
					archived: session.archived ?? false,
				},
				ackedAt(session.id),
			),
			archived: session.archived ?? false,
			prUrl: null,
			hasLiveTerminal: false,
			forkDisabledReason: null,
			cwd: null,
			bridgeSessionId: null,
		},
		capabilities,
		{
			surface: "palette-card",
		},
	).flatMap((entry): CardItem<SessionMenuItemId>[] => (entry.kind === "item" ? [entry] : []));
	const items: CardItem<OpenItemId | SessionMenuItemId>[] = [...OPEN_ITEMS, ...sessionItems];

	const run = (id: OpenItemId | SessionMenuItemId): void =>
	{
		if (id === "open")
		{
			onOpen();
			return;
		}
		if (id === "rename")
		{
			onRename(session);
			return;
		}
		onClose(
			{
				refocus: true,
			},
		);
		switch (id)
		{
			case "open-new-tab":
				window.open(sessionUrl(session.id), "_blank", "noopener,noreferrer");
				return;
			case "copy-link":
				void copySessionLink(session.id, toast, queryClient);
				return;
			case "pin":
			case "unpin":
				if (id === "pin") pin(session.id);
				else unpin(session.id);
				return;
			case "mark-read":
				markSeen(session.id);
				return;
			case "mark-completed":
				markCompleted(session.id, completedAckAt(session.mtime, session.failedAt));
				return;
			case "mark-unread":
				markUnseen(
					session.id,
					{
						explicit: true,
					},
				);
				return;
			case "archive":
			case "unarchive":
				setArchived(id === "archive");
				return;
			case "open-in":
			case "open-live-terminal":
			case "open-terminal":
			case "open-vscode":
			case "open-finder":
			case "open-claude-ai":
			case "open-pr":
			case "move-up":
			case "move-down":
			case "fork":
			case "toggle-nested-sessions":
			case "move-to-group":
			case "move-to-custom-group":
			case "ungroup":
			case "new-group":
			case "transcript-view":
			case "terminal-view":
			case "transcript-mode":
			case "make-default-transcript-mode":
			case "output-style":
			case "output-style-option":
			case "new-output-style":
				return;
			default:
				assertNever(id);
		}
	};

	return (
		<RowActionsCardShell
			anchorRect={anchorRect}
			preview={
			{
				title: session.title,
				kind: "Code session",
				when: relativeBucket(Date.parse(session.mtime), Date.now()),
			}}
			items={items}
			onRun={run}
			onClose={onClose}
		/>
	);
}

type ArtifactItemId = OpenItemId | "copy-link" | "pin" | "unpin";

/**
 * Upstream's artifact card `mt`: Open, Open in new tab, Copy link and Pin/Unpin. Local artifacts open at
 * `/artifact/<id>`, copy their claude.ai link (as the Artifacts page does) and pin per browser. Upstream's Open
 * conversation is claude.ai-chat-only. A screenshot heads the card, which morphs out of the shown thumb card.
 */
function ArtifactCard({
	artifact,
	onOpen,
	onClose,
	anchorRect,
	morphFrom = null,
	screenshot,
}: CardProps &
{
	artifact: ArtifactSummary;
	screenshot: boolean;
})
{
	const toast = useToast();
	const pinned = useArtifactPins().isPinned(artifact.url);
	const thumbnailUrl = screenshot ? artifact.thumbnailUrl : null;
	const thumb = useMemo(
		(): PaletteThumb | undefined =>
			thumbnailUrl === null
				? undefined
				:
					{
						src: thumbnailUrl,
					},
		[thumbnailUrl],
	);
	const items: CardItem<ArtifactItemId>[] = [
		...OPEN_ITEMS,
		{
			id: "copy-link",
			label: "Copy link",
		},
		pinned
			?
				{
					id: "unpin",
					label: "Unpin",
				}
			:
				{
					id: "pin",
					label: "Pin",
				},
	];

	const run = (id: ArtifactItemId): void =>
	{
		if (id === "open")
		{
			onOpen();
			return;
		}
		onClose(
			{
				refocus: true,
			},
		);
		switch (id)
		{
			case "open-new-tab":
				window.open(localUrl("artifact", artifact.id), "_blank", "noopener,noreferrer");
				return;
			case "copy-link":
				void copyLink(artifact.url, toast);
				return;
			case "pin":
			case "unpin":
				toggleArtifactPin(artifact.url, id === "unpin");
				return;
			default:
				assertNever(id);
		}
	};

	return (
		<RowActionsCardShell
			anchorRect={anchorRect}
			thumb={thumb}
			morphFrom={morphFrom}
			preview={
			{
				title: artifact.title === "" ? "Untitled artifact" : artifact.title,
				kind: artifact.kind === "docs" ? "Docs" : "Artifact",
				when: relativeBucket(artifactTimestamp(artifact), Date.now()),
			}}
			items={items}
			onRun={run}
			onClose={onClose}
		/>
	);
}

type ProjectItemId = OpenItemId | "copy-link";

/**
 * Upstream's Claude Code project card `ct`: Open, Open in new tab and Copy link, under a "Project" meta with no
 * time. Upstream's Settings (cloud project permissions) and Pin (behind the project-pin flag) have no local
 * analogue: local projects are `~/.claude/projects` folders.
 */
function ProjectCard({
	project,
	onOpen,
	onClose,
	anchorRect,
}: CardProps &
{
	project: PaletteCardProject;
})
{
	const toast = useToast();
	const items: CardItem<ProjectItemId>[] = [
		...OPEN_ITEMS,
		{
			id: "copy-link",
			label: "Copy link",
		},
	];

	const run = (id: ProjectItemId): void =>
	{
		if (id === "open")
		{
			onOpen();
			return;
		}
		onClose(
			{
				refocus: true,
			},
		);
		switch (id)
		{
			case "open-new-tab":
				window.open(localUrl("project", project.id), "_blank", "noopener,noreferrer");
				return;
			case "copy-link":
				void copyLink(localUrl("project", project.id), toast);
				return;
			default:
				assertNever(id);
		}
	};

	return (
		<RowActionsCardShell
			anchorRect={anchorRect}
			preview={
			{
				title: project.name === "" ? "Untitled project" : project.name,
				kind: "Project",
				when: null,
			}}
			items={items}
			onRun={run}
			onClose={onClose}
		/>
	);
}

/**
 * Upstream's generic card `yt` (c09d7445a), the dispatcher's default for web rows with an href (scheduled_task,
 * thread): just Open and Open in new tab under "title" and "kind · when", with no tail.
 */
function GenericCard({
	row,
	onOpen,
	onClose,
	anchorRect,
}: CardProps &
{
	row: PaletteCardGeneric;
})
{
	const run = (id: OpenItemId): void =>
	{
		if (id === "open")
		{
			onOpen();
			return;
		}
		onClose(
			{
				refocus: true,
			},
		);
		window.open(`${window.location.origin}${row.href}`, "_blank", "noopener,noreferrer");
	};

	return (
		<RowActionsCardShell
			anchorRect={anchorRect}
			preview={
			{
				title: row.title,
				kind: row.kindLabel,
				when: row.when,
			}}
			items={OPEN_ITEMS}
			onRun={run}
			onClose={onClose}
		/>
	);
}

function localUrl(route: "artifact" | "project", id: string): string
{
	return `${window.location.origin}/${route}/${encodeURIComponent(id)}`;
}

/** Upstream's card shell `nt` with header `it`: the menu, its keys, and the numbered items. */
function RowActionsCardShell<Id extends string>({
	anchorRect,
	thumb,
	morphFrom = null,
	preview,
	items,
	onRun,
	onClose,
}: {
	anchorRect: Box;
	/** Upstream's header screenshot, shown until it fails. */
	thumb?: PaletteThumb | undefined;
	morphFrom?:
	{
		x: number;
		y: number;
	} | null;
	preview: CardPreview;
	items: readonly CardItem<Id>[];
	onRun: (id: Id) => void;
	onClose: (options: RowActionsCloseOptions) => void;
})
{
	const anchor = useMemo(() => virtualAnchor(anchorRect), [anchorRect]);
	const usableThumb = useUsableThumb(thumb);
	const [thumbFailed, setThumbFailed] = useState(false);
	const headerThumb = thumbFailed ? undefined : usableThumb;
	// Upstream's title-in and unfold run once, with the morph, and drop on the unfold's own animationend.
	const [unfolding, setUnfolding] = useState(morphFrom !== null);

	// When the live item list last changed after opening; digits are ignored for ROW_ACTIONS_DIGIT_GUARD_MS after it.
	const itemsKey = items.map((item) => item.id).join(" ");
	const itemsKeyRef = useRef(itemsKey);
	const itemsChangedAtRef = useRef(Number.NEGATIVE_INFINITY);
	useLayoutEffect(() =>
	{
		if (itemsKeyRef.current === itemsKey) return;
		itemsKeyRef.current = itemsKey;
		itemsChangedAtRef.current = performance.now();
	}, [itemsKey]);

	// Upstream focuses the first item after two frames, once Base UI has settled the popup's own focus.
	useEffect(() =>
	{
		let second = 0;
		const first = requestAnimationFrame(() =>
		{
			second = requestAnimationFrame(() =>
			{
				document.querySelector<HTMLElement>('[data-palette-row-actions] [role="menuitem"]')?.focus(
					{
						preventScroll: true,
					},
				);
			});
		});
		return () =>
		{
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
		};
	}, []);

	function closeFromKey(event: KeyboardEvent<HTMLDivElement>, options: RowActionsCloseOptions)
	{
		event.preventDefault();
		event.stopPropagation();
		onClose(options);
	}

	function handleKeyDownCapture(event: KeyboardEvent<HTMLDivElement>)
	{
		const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
		if (isAltEnter(event) || (event.key === "Enter" && event.repeat))
		{
			closeFromKey(
				event,
				{
					refocus: true,
					swallowRepeat: "Enter",
				},
			);
		}
		else if (event.key === "ArrowLeft" && plain && !event.repeat)
		{
			closeFromKey(
				event,
				{
					refocus: true,
					swallowRepeat: "ArrowLeft",
				},
			);
		}
		else if (event.key === "Tab")
		{
			closeFromKey(
				event,
				{
					refocus: true,
				},
			);
		}
		else if (
			DIGIT_KEY.test(event.code) &&
			performance.now() - itemsChangedAtRef.current < ROW_ACTIONS_DIGIT_GUARD_MS
		)
		{
			// The accelerator handler skips default-prevented keys.
			event.preventDefault();
		}
	}

	const meta = [preview.kind, preview.when].filter((part) => part !== undefined && part !== null).join(" · ");

	return (
		<Menu
			open
			onOpenChange={(open) =>
			{
				if (!open)
					onClose(
						{
							refocus: true,
						},
					);
			}}
		>
			<MenuContent
				density="compact"
				side={inlineEndSide()}
				align="start"
				sideOffset={-CARD_OVERLAP_PX}
				collisionAvoidance={SHIFT_COLLISION_AVOIDANCE}
				anchor={anchor}
				finalFocus={false}
				className={`w-[280px] ${morphFrom === null ? "animate-palette-card-in" : "animate-palette-card-morph"} motion-reduce:animate-none`}
				popupProps={
				{
					"aria-label": "Actions",
					"data-palette-row-actions": "",
					...(morphFrom === null
						? {}
						:
							{
								"data-from-thumb-card": "true",
							}),
					// Upstream's cardSlide: the enter starts 12px back toward the palette (mirrored in RTL).
					style:
					{
						"--cp-card-slide": inlineEndSide() === "left" ? "12px" : "-12px",
						...(morphFrom === null
							? {}
							:
								{
									"--cp-card-from-x": `${morphFrom.x}px`,
									"--cp-card-from-y": `${morphFrom.y}px`,
								}),
					},
					onKeyDownCapture: handleKeyDownCapture,
				}}
				header={
					<>
						{headerThumb !== undefined && (
							<div className="-mx-[var(--cds-menu-gutter,0.25rem)] -mt-[var(--cds-menu-gutter,0.25rem)] px-1.5 pt-1.5 pb-1">
								<PaletteThumbImage
									thumb={headerThumb}
									onFailed={() =>
									{
										setThumbFailed(true);
									}}
								/>
							</div>
						)}
						<div
							className={`flex flex-col gap-0.5 px-2.5 pt-1 pb-1${unfolding ? " animate-palette-card-title-in motion-reduce:animate-none" : ""}`}
						>
							<div data-palette-card-title="" className="line-clamp-2 break-words text-body text-primary">
								{preview.title}
							</div>
							{meta !== "" && (
								<div
									data-palette-card-meta=""
									className="truncate text-[11px]/[17px] text-[var(--menu-muted)]"
								>
									{meta}
								</div>
							)}
						</div>
					</>
				}
			>
				<div
					className={unfolding ? "grid animate-palette-card-unfold motion-reduce:animate-none" : undefined}
					onAnimationEnd={(event) =>
					{
						if (event.target === event.currentTarget) setUnfolding(false);
					}}
				>
					<div className={unfolding ? "min-h-0 overflow-hidden" : undefined}>
						<MenuSeparator />
						{items.map((item, index) => (
							<MenuItem
								key={item.id}
								accelerator={String(index + 1)}
								acceleratorVariant="keycap"
								closeOnClick={false}
								data-card-item={item.id}
								onSelect={() =>
								{
									onRun(item.id);
								}}
							>
								{item.label}
							</MenuItem>
						))}
					</div>
				</div>
			</MenuContent>
		</Menu>
	);
}

/** Upstream's hover "…" beside a session row; hidden from AT, which uses ⌥⏎ instead. */
export function PaletteRowActionsButton({onOpen}: {onOpen: () => void})
{
	return (
		<span
			aria-hidden="true"
			data-palette-own-keys=""
			className="pointer-events-none absolute inset-y-0 end-9 flex items-center *:pointer-events-auto"
		>
			<Tooltip content="Actions" side="left">
				<button
					type="button"
					aria-label="Actions"
					tabIndex={-1}
					data-palette-row-actions-button=""
					onMouseDown={(event) =>
					{
						event.preventDefault();
					}}
					onClick={onOpen}
					className="flex size-6 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover pointer-coarse:hidden"
				>
					<Ellipsis aria-hidden="true" className="size-4" />
				</button>
			</Tooltip>
		</span>
	);
}

/** The row card's Rename: upstream's rename dialog over the palette, saving through the session title API. */
export function PaletteRenameDialog({
	session,
	open,
	onClose,
	onClosed,
	finalFocus,
	paletteOwned = false,
}: {
	session: PaletteCardSession;
	open: boolean;
	onClose: () => void;
	onClosed: () => void;
	finalFocus: RefObject<HTMLElement | null>;
	/** Opened from inside the ⌘K palette rather than a session chip. */
	paletteOwned?: boolean;
})
{
	const mutation = useRenameSessionMutation(session.id);
	const toast = useToast();
	return (
		<SessionRenameDialog
			open={open}
			initialName={session.title}
			onClose={onClose}
			onClosed={onClosed}
			finalFocus={finalFocus}
			paletteOwned={paletteOwned}
			onRename={(name) =>
			{
				mutation.mutate(
					name,
					{
						onError: () =>
						{
							toast(
								{
									kind: "error",
									message: RENAME_FAILED_MESSAGE,
								},
							);
						},
					},
				);
			}}
		/>
	);
}
