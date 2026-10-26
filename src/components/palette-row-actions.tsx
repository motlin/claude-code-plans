import {useQueryClient} from "@tanstack/react-query";
import {Ellipsis} from "lucide-react";
import {type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef} from "react";

import {useSessionArchive} from "../hooks/use-session-archive";
import {assertNever} from "../lib/assert-never";
import {pin, unpin, usePins} from "../lib/pin-store";
import {relativeBucket} from "../lib/search-text";
import {copySessionLink, sessionUrl} from "../lib/session-open-in";
import {
	getSessionMenuItems,
	type SessionMenuCapability,
	type SessionMenuItemId,
	sessionMenuReadState,
} from "../lib/session-menu-items";
import type {SessionBucket} from "../lib/session-state";
import {markSeen, markUnseen} from "../lib/unread-store";
import {useHasUnseenWork} from "./use-has-unseen-work";
import {useToast} from "./toast-context";
import {inlineEndSide, Menu, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";

/** A session row the ⌥⏎ card can act on; `archived`/`bucket` are unknown for server-only hits. */
export interface PaletteCardSession {
	id: string;
	title: string;
	mtime: string;
	archived: boolean | undefined;
	bucket: SessionBucket | undefined;
}

type CardItemId = "open" | "open-new-tab" | SessionMenuItemId;

interface CardItem {
	id: CardItemId;
	label: string;
}

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Upstream's `panelScale`: the palette recedes to this while the card is open. */
const RECEDE_SCALE = 0.97;
/** Upstream's `cardLift`. */
const CARD_LIFT_PX = 4;
/** Upstream's `cardOverlap`: the card's inline-start edge sits this far over the receded palette. */
const CARD_OVERLAP_PX = 44;

/**
 * Upstream's card anchor: the results list's x and width at the selected row's y (clamped into the list
 * viewport), scaled by the recede about the dialog's centre unless motion is reduced, then lifted 4px.
 */
export function rowActionsAnchorRect({
	list,
	row,
	dialog,
	reducedMotion,
}: {
	list: Box;
	row: Pick<Box, "y" | "height">;
	dialog: Box;
	reducedMotion: boolean;
}): Box {
	const y = Math.min(Math.max(row.y, list.y), Math.max(list.y, list.y + list.height - row.height));
	const scale = reducedMotion ? 1 : RECEDE_SCALE;
	const centreX = dialog.x + dialog.width / 2;
	const centreY = dialog.y + dialog.height / 2;
	return {
		x: centreX + (list.x - centreX) * scale,
		y: centreY + (y - centreY) * scale - CARD_LIFT_PX,
		width: list.width * scale,
		height: row.height * scale,
	};
}

function virtualAnchor(box: Box) {
	return {
		getBoundingClientRect: () => ({
			...box,
			top: box.y,
			left: box.x,
			right: box.x + box.width,
			bottom: box.y + box.height,
			toJSON: () => box,
		}),
	};
}

const SHIFT_COLLISION_AVOIDANCE = {side: "shift", align: "shift"} as const;

/** Upstream's `Ze`: digits are ignored this long after the item list changes, so a late item isn't mis-hit. */
const ROW_ACTIONS_DIGIT_GUARD_MS = 300;

const DIGIT_KEY = /^(?:Digit|Numpad)?([1-9])$/;

/** A held key whose auto-repeats the palette swallows after the card opens or closes on its first press. */
export type RowActionsRepeatKey = "Enter" | "ArrowLeft";

export interface RowActionsCloseOptions {
	refocus: boolean;
	swallowRepeat?: RowActionsRepeatKey;
}

/** Upstream's `Cs`: Enter with Alt or AltGraph, no Shift or Meta, not mid-IME composition. */
export function isAltEnter(event: KeyboardEvent<HTMLElement>): boolean {
	return (
		event.key === "Enter" &&
		(event.altKey || event.getModifierState("AltGraph")) &&
		!event.shiftKey &&
		!event.metaKey &&
		!event.nativeEvent.isComposing
	);
}

/**
 * The claude.ai/code ⌘K row-actions card: a 280px compact cds Menu overlapping the receded palette's
 * inline-end edge by 44px, with the session title, "Code session · <bucket>" and items numbered 1…N. Its modal
 * backdrop eats the first click outside. ←, Esc, Tab, ⌥⏎ again or a held Enter close only the card; digits
 * ignore repeats and the first 300ms after the item list changes. Delete is never offered
 * (transcripts are never deleted).
 */
export function PaletteRowActionsCard({
	session,
	anchorRect,
	onOpen,
	onRename,
	onClose,
}: {
	session: PaletteCardSession;
	/** The anchor box from {@link rowActionsAnchorRect}, measured once as the card opens. */
	anchorRect: Box;
	onOpen: (id: string) => void;
	/** Closes the palette and starts the session's inline rename, as ⌥⌘R does. */
	onRename: (id: string) => void;
	onClose: (options: RowActionsCloseOptions) => void;
}) {
	const queryClient = useQueryClient();
	const unseen = useHasUnseenWork(session.id);
	const pins = usePins();
	const toast = useToast();
	const setArchived = useSessionArchive(session.id);
	const anchor = useMemo(() => virtualAnchor(anchorRect), [anchorRect]);

	const capabilities = new Set<SessionMenuCapability>(["pin", "rename", "readState", "ackAwaiting", "copyLink"]);
	if (session.archived !== undefined) capabilities.add("archive");
	const sessionItems = getSessionMenuItems(
		{
			title: session.title,
			pinned: pins.isPinned(session.id),
			readState: sessionMenuReadState(session.bucket, unseen),
			archived: session.archived ?? false,
			prUrl: null,
			hasLiveTerminal: false,
			forkDisabledReason: null,
			cwd: null,
			bridgeSessionId: null,
		},
		capabilities,
		{surface: "palette-card"},
	).flatMap((entry): CardItem[] => (entry.kind === "item" ? [entry] : []));
	const items: CardItem[] = [
		{id: "open", label: "Open"},
		{id: "open-new-tab", label: "Open in new tab"},
		...sessionItems,
	];

	// When the live item list last changed after opening; digits are ignored for ROW_ACTIONS_DIGIT_GUARD_MS after it.
	const itemsKey = items.map((item) => item.id).join(" ");
	const itemsKeyRef = useRef(itemsKey);
	const itemsChangedAtRef = useRef(Number.NEGATIVE_INFINITY);
	useLayoutEffect(() => {
		if (itemsKeyRef.current === itemsKey) return;
		itemsKeyRef.current = itemsKey;
		itemsChangedAtRef.current = performance.now();
	}, [itemsKey]);

	// Upstream focuses the first item after two frames, once Base UI has settled the popup's own focus.
	useEffect(() => {
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(() => {
				document
					.querySelector<HTMLElement>('[data-palette-row-actions] [role="menuitem"]')
					?.focus({preventScroll: true});
			});
		});
		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
		};
	}, []);

	const run = (id: CardItemId): void => {
		if (id === "open") {
			onOpen(session.id);
			return;
		}
		if (id === "rename") {
			onRename(session.id);
			return;
		}
		onClose({refocus: true});
		switch (id) {
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
			case "mark-completed":
				markSeen(session.id);
				return;
			case "mark-unread":
				markUnseen(session.id);
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
			case "move-to-group":
			case "move-to-custom-group":
			case "ungroup":
			case "new-group":
			case "transcript-view":
			case "transcript-mode":
			case "make-default-transcript-mode":
				return;
			default:
				assertNever(id);
		}
	};

	function closeFromKey(event: KeyboardEvent<HTMLDivElement>, options: RowActionsCloseOptions) {
		event.preventDefault();
		event.stopPropagation();
		onClose(options);
	}

	function handleKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
		const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
		if (isAltEnter(event) || (event.key === "Enter" && event.repeat)) {
			closeFromKey(event, {refocus: true, swallowRepeat: "Enter"});
		} else if (event.key === "ArrowLeft" && plain && !event.repeat) {
			closeFromKey(event, {refocus: true, swallowRepeat: "ArrowLeft"});
		} else if (event.key === "Tab") {
			closeFromKey(event, {refocus: true});
		} else if (
			DIGIT_KEY.test(event.code) &&
			performance.now() - itemsChangedAtRef.current < ROW_ACTIONS_DIGIT_GUARD_MS
		) {
			// The accelerator handler skips default-prevented keys.
			event.preventDefault();
		}
	}

	const bucket = relativeBucket(Date.parse(session.mtime), Date.now());

	return (
		<Menu
			open
			onOpenChange={(open) => {
				if (!open) onClose({refocus: true});
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
				className="w-[280px] animate-in fade-in slide-in-from-left-3 duration-150 motion-reduce:animate-none"
				popupProps={{
					"aria-label": "Actions",
					"data-palette-row-actions": "",
					onKeyDownCapture: handleKeyDownCapture,
				}}
				header={
					<div className="flex flex-col gap-0.5 px-2 pt-1 pb-1">
						<div
							data-palette-card-title=""
							className="line-clamp-2 break-words text-[13px]/[19px] text-primary"
						>
							{session.title}
						</div>
						<div data-palette-card-meta="" className="truncate text-[11px]/[17px] text-[var(--menu-muted)]">
							{bucket === null ? "Code session" : `Code session · ${bucket}`}
						</div>
					</div>
				}
			>
				<MenuSeparator />
				{items.map((item, index) => (
					<MenuItem
						key={item.id}
						accelerator={String(index + 1)}
						closeOnClick={false}
						data-card-item={item.id}
						onSelect={() => {
							run(item.id);
						}}
					>
						{item.label}
					</MenuItem>
				))}
			</MenuContent>
		</Menu>
	);
}

/** Upstream's hover "…" beside a session row; hidden from AT, which uses ⌥⏎ instead. */
export function PaletteRowActionsButton({onOpen}: {onOpen: () => void}) {
	return (
		<span
			aria-hidden="true"
			className="pointer-events-none absolute inset-y-0 right-9 flex items-center opacity-0 group-hover/palette-row:opacity-100 peer-data-[selected=true]:opacity-100 pointer-coarse:hidden *:pointer-events-auto"
		>
			<Tooltip content="Actions" side="left">
				<button
					type="button"
					aria-label="Actions"
					tabIndex={-1}
					data-palette-row-actions-button=""
					onMouseDown={(event) => {
						event.preventDefault();
					}}
					onClick={onOpen}
					className="flex size-6 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover"
				>
					<Ellipsis aria-hidden="true" className="size-4" />
				</button>
			</Tooltip>
		</span>
	);
}
