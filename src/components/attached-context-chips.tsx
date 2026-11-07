import {
	type CSSProperties,
	type KeyboardEvent,
	lazy,
	type MouseEvent,
	type ReactNode,
	Suspense,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	ClipboardPaste,
	FileText,
	Image as ImageIcon,
	MessageSquare,
	MessageSquareText,
	SquareTerminal,
	TextQuote,
	X,
} from "lucide-react";

import {
	type ContextChip,
	contextChipLabel,
	focusComposer,
	formatContextAttachment,
	removeContextChip,
} from "../lib/context-attach";
import {type QueuedDiffComment, removeQueuedDiffComment} from "../lib/diff-comments";
import {TEXT_PREVIEW_LIMIT} from "../lib/text-preview";
import {isTextPreviewable} from "../lib/text-preview-extensions";
import {FileActionsMenuItems} from "./files/file-actions-menu";
import {absoluteMentionPath} from "./files/mention-path";
import {ContextMenu, ContextMenuTrigger, MenuContent} from "./ui/menu";
import {Skeleton} from "./ui/skeleton";
import {ExcerptQuote} from "./message-excerpt-tiles";
import {motionReduced} from "../lib/motion";
import {
	BADGE_CLASS,
	CARD_BODY_CLASS,
	CARD_CLASS,
	CARD_FILL_CLASS,
	TILE_CLASS,
	TILE_REMOVE_CLASS,
} from "./attachment-tile-classes";

// The preview loads only when a tile opens, keeping its dialog out of the composer chunk.
const ImagePreviewModal = lazy(async () =>
	import("./image-preview-modal").then((module) => ({default: module.ImagePreviewModal})),
);
const TextPreviewDialog = lazy(async () =>
	import("./text-preview-dialog").then((module) => ({default: module.TextPreviewDialog})),
);

function chipLabel({path, line, endLine}: QueuedDiffComment): string {
	const name = path.slice(path.lastIndexOf("/") + 1) || path;
	return `${name}:${endLine === undefined || endLine === line ? line : `${line}-${endLine}`}`;
}

const CHIP_CLASS =
	"flex h-6 max-w-[16rem] min-w-0 items-center gap-1 rounded-r6 border border-border bg-surface-3 ps-1.5 pe-0.5 text-footnote text-secondary";

const CHIP_REMOVE_CLASS =
	"flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r5 hover:bg-fill-ghost-hover hover:text-primary";

const CONTEXT_CHIP_ICON = {
	file: FileText,
	selection: TextQuote,
	terminal: SquareTerminal,
	image: ImageIcon,
	message: MessageSquareText,
	excerpt: TextQuote,
	"pasted-text": ClipboardPaste,
} satisfies Record<ContextChip["kind"], unknown>;

/**
 * Upstream's `Rn`: the element that takes focus in a tile or pill, its
 * CardLink, else the pill's remove button, else the tile root itself.
 */
function focusTarget(item: Element): HTMLElement | null {
	const target = item.querySelector<HTMLElement>('[data-cds="CardLink"], button[aria-label^="Remove "]');
	if (target !== null) return target;
	return item instanceof HTMLElement && item.hasAttribute("tabindex") ? item : null;
}

/**
 * Upstream's `Ny`: scrolls the row instantly so the tile sits inside its view,
 * less the scroll padding `scroll-fade-x` reserves under each edge fade.
 * Client-rect deltas map onto scrollLeft the same way in RTL rows.
 */
function scrollTileIntoRow(row: HTMLElement, tile: Element): void {
	if (typeof row.scrollTo !== "function") return;
	const style = getComputedStyle(row);
	const padLeft = Number.parseFloat(style.scrollPaddingLeft) || 0;
	const padRight = Number.parseFloat(style.scrollPaddingRight) || 0;
	const view = row.getBoundingClientRect();
	const rect = tile.getBoundingClientRect();
	const start = view.left + padLeft;
	const end = view.right - padRight;
	let delta = 0;
	if (rect.left < start) delta = rect.left - start;
	else if (rect.right > end) delta = Math.min(rect.right - end, rect.left - start);
	if (delta !== 0) row.scrollTo({left: row.scrollLeft + delta, behavior: "instant"});
}

/** Upstream's `A0`: once the removed tile leaves the row, scrolls the tile that took focus into view. */
function scrollIntoRowAfterRemoval(row: HTMLElement, tile: Element, removed: Element): void {
	let done = false;
	const observer =
		typeof MutationObserver === "function"
			? new MutationObserver(() => {
					if (!removed.isConnected) finish();
				})
			: null;
	const timer = setTimeout(finish, 300);
	observer?.observe(row, {childList: true});
	function finish() {
		if (done) return;
		done = true;
		observer?.disconnect();
		clearTimeout(timer);
		if (tile.isConnected) scrollTileIntoRow(row, tile);
	}
}

/**
 * After a keyboard removal of the last tile, upstream's `D5` swallows that
 * key's repeats and focuses the editor on its keyup, so a held Backspace
 * doesn't go on to delete prompt text; a window blur cancels the hand-off.
 */
function focusComposerOnKeyUp(sessionId: string, key: string, removed: Element): void {
	const view = removed.ownerDocument.defaultView;
	if (view === null) return;
	const onKeyDown = (event: globalThis.KeyboardEvent) => {
		if (event.key === key && event.repeat) {
			event.preventDefault();
			event.stopPropagation();
		}
	};
	const onKeyUp = (event: globalThis.KeyboardEvent) => {
		if (event.key !== key) return;
		stop();
		const active = removed.ownerDocument.activeElement;
		if (active === null || active === removed.ownerDocument.body || removed.contains(active)) {
			focusComposer(sessionId);
		}
	};
	const stop = () => {
		view.removeEventListener("keydown", onKeyDown, true);
		view.removeEventListener("keyup", onKeyUp, true);
		view.removeEventListener("blur", stop);
	};
	view.addEventListener("keydown", onKeyDown, true);
	view.addEventListener("keyup", onKeyUp, true);
	view.addEventListener("blur", stop);
}

/**
 * Upstream's `D5`: when the item being removed holds focus, hand it to the
 * next item, else the previous one, without scrolling, then scroll it into
 * the row once the removed item is gone. With no item left, focus goes to the
 * composer: at once for a click, on the key's keyup for a keyboard removal.
 */
function handOffFocus(item: Element | null, sessionId: string, key: string | null): void {
	const active = item?.ownerDocument.activeElement;
	if (item === null || !(active instanceof HTMLElement) || !item.contains(active)) return;
	const target = siblingFocusTarget(item);
	if (target === null) {
		if (key === null) focusComposer(sessionId);
		else focusComposerOnKeyUp(sessionId, key, item);
		return;
	}
	target.focus({preventScroll: true});
	const row = item.parentElement;
	const tile = target.closest("li");
	if (row !== null && tile !== null) scrollIntoRowAfterRemoval(row, tile, item);
}

/** Upstream's `sk`: the next item's focus target, else the previous one's. */
function siblingFocusTarget(item: Element): HTMLElement | null {
	for (let next = item.nextElementSibling; next !== null; next = next.nextElementSibling) {
		const target = focusTarget(next);
		if (target !== null) return target;
	}
	for (let previous = item.previousElementSibling; previous !== null; previous = previous.previousElementSibling) {
		const target = focusTarget(previous);
		if (target !== null) return target;
	}
	return null;
}

/** Upstream's `Vn`: a pointer press on a remove button doesn't take focus, so the editor keeps it. */
function keepFocusOnPointerRemove(event: MouseEvent<HTMLButtonElement>): void {
	event.preventDefault();
}

/**
 * A remove button's handlers: a click hands focus off from the item it
 * removes; Enter removes on keydown and, for the last item, focuses the
 * editor on Enter's keyup, as upstream's `D5` does with the key.
 */
function removeButtonProps(sessionId: string, remove: () => void) {
	return {
		onMouseDown: keepFocusOnPointerRemove,
		onClick: (event: MouseEvent<HTMLButtonElement>) => {
			handOffFocus(event.currentTarget.closest("li"), sessionId, null);
			remove();
		},
		onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
			if (event.key !== "Enter" || event.repeat || event.nativeEvent.isComposing) return;
			event.preventDefault();
			handOffFocus(event.currentTarget.closest("li"), sessionId, event.key);
			remove();
		},
	};
}

/**
 * Upstream's `Fi`: Delete or Backspace on a focused CardLink removes its tile,
 * handing focus off first; modifiers, key repeat and IME composition don't.
 */
function removeOnDeleteKey(event: KeyboardEvent<HTMLElement>, sessionId: string, remove: () => void): void {
	if (event.key !== "Delete" && event.key !== "Backspace") return;
	if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
	if (event.repeat || event.nativeEvent.isComposing) return;
	event.preventDefault();
	handOffFocus(event.currentTarget.closest("li"), sessionId, event.key);
	remove();
}

/** Upstream's `ry`: a tile taking keyboard focus scrolls into the row's view. */
function scrollFocusedTileIntoRow(row: HTMLElement, event: globalThis.FocusEvent): void {
	const target = event.target;
	if (!(target instanceof HTMLElement)) return;
	let visible = false;
	try {
		visible = target.matches(":focus-visible");
	} catch {
		// A browser that can't parse :focus-visible scrolls nothing.
	}
	if (!visible) return;
	const tile = target.closest("li");
	if (tile?.parentElement === row) scrollTileIntoRow(row, tile);
}

interface TransitionDocument {
	startViewTransition?: (options: {types: string[]; update: () => void}) => unknown;
}

/**
 * Upstream's `Ks`: runs a tray change inside a `cds-attachments` view
 * transition, so the old tile shrinks out while its siblings slide; at once
 * in a hidden tab, under reduced motion, or without view-transition types.
 */
function withAttachmentsTransition(update: () => void): void {
	const start = (document as TransitionDocument).startViewTransition;
	const supported =
		typeof CSS !== "undefined" &&
		typeof CSS.supports === "function" &&
		CSS.supports("selector(:active-view-transition-type(cds-attachments))");
	if (start === undefined || !supported || document.visibilityState === "hidden" || motionReduced()) {
		update();
		return;
	}
	start.call(document, {types: ["cds-attachments"], update});
}

/** Upstream's `--cds-attachment-vt-name`: the tile's view-transition name, its id made ident-safe. */
function viewTransitionStyle(id: string): CSSProperties {
	return {"--cds-attachment-vt-name": `cds-attachment-${id.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`};
}

function removeChip(sessionId: string, chip: ContextChip): void {
	withAttachmentsTransition(() => {
		if (chip.previewUrl !== undefined && typeof URL.revokeObjectURL === "function") {
			URL.revokeObjectURL(chip.previewUrl);
		}
		removeContextChip(sessionId, chip.id);
	});
}

/**
 * Upstream's pending tile state: `data-state="pending"`, `aria-busy`, a
 * Skeleton over the body, and an sr-only status beside it.
 */
function pendingProps(chip: ContextChip) {
	return chip.status === "pending" ? {"data-state": "pending", "aria-busy": true} : {};
}

function PendingSkeleton() {
	return (
		<span aria-hidden="true" className="contents">
			<Skeleton className="pointer-events-none absolute inset-0 size-full rounded-card-xs" />
		</span>
	);
}

/** Upstream's tile shell: Card, fill, body, the corner remove button and the pending status. */
function Tile({
	sessionId,
	chip,
	restored,
	kind,
	status,
	name = contextChipLabel(chip),
	children,
}: {
	sessionId: string;
	chip: ContextChip;
	/** Upstream's `data-cds-attachment-restored`: the tile was staged before this composer mounted. */
	restored: boolean;
	kind: "MessageAttachmentsImage" | "MessageAttachmentsFile" | "MessageAttachmentsQuote";
	status: string;
	/** What the remove button names, when it isn't the chip's label: an excerpt's own text. */
	name?: string;
	children: ReactNode;
}) {
	const label = contextChipLabel(chip);
	const pending = chip.status === "pending";
	const ref = useRef<HTMLLIElement>(null);
	// Upstream's `nr`: a tile added after the row mounted scrolls into its view.
	useLayoutEffect(() => {
		const tile = ref.current;
		const row = tile?.parentElement;
		if (!restored && tile && row) scrollTileIntoRow(row, tile);
		// Only on mount: a restored tile never scrolls, and a tile scrolls once.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return (
		<li
			ref={ref}
			data-chip-label={label}
			data-cds={kind}
			data-cds-attachment=""
			{...(restored ? {"data-cds-attachment-restored": ""} : {})}
			tabIndex={-1}
			style={viewTransitionStyle(chip.id)}
			{...pendingProps(chip)}
			className={TILE_CLASS}
		>
			<div data-cds="Card" data-size="xs" className={CARD_CLASS}>
				<span aria-hidden="true" className={CARD_FILL_CLASS} />
				<div data-cds-card-body="" className={CARD_BODY_CLASS}>
					{children}
					{pending ? <PendingSkeleton /> : null}
				</div>
			</div>
			<button
				type="button"
				data-cds-attachment-remove=""
				aria-label={`Remove ${name}`}
				{...removeButtonProps(sessionId, () => {
					removeChip(sessionId, chip);
				})}
				className={TILE_REMOVE_CLASS}
			>
				<X aria-hidden="true" className="size-3" />
			</button>
			{pending ? (
				<span role="status" className="sr-only">
					{status}
				</span>
			) : null}
		</li>
	);
}

/**
 * An attached image as upstream's cds image tile: the picture contained in a
 * 120px card, a zoom CardLink once it's ready, and an Image glyph when the
 * bytes don't decode.
 */
function ImageChip({
	sessionId,
	chip,
	restored,
	onOpen,
}: {
	sessionId: string;
	chip: ContextChip;
	restored: boolean;
	/** Opens the preview, morphing out of the tile's image. */
	onOpen: (chip: ContextChip, origin: HTMLImageElement | null) => void;
}) {
	const label = contextChipLabel(chip);
	const pending = chip.status === "pending";
	const imgRef = useRef<HTMLImageElement>(null);
	const [loaded, setLoaded] = useState(false);
	const [broken, setBroken] = useState(false);
	const opacity = broken ? "opacity-0" : pending ? (loaded ? "opacity-50" : "opacity-0") : "opacity-100";
	const img = (
		<img
			ref={imgRef}
			src={chip.previewUrl}
			alt={pending ? label : ""}
			loading="lazy"
			decoding="async"
			width={120}
			height={120}
			onLoad={() => {
				setLoaded(true);
			}}
			onError={() => {
				setBroken(true);
			}}
			className={`absolute inset-0 block size-full rounded-card-xs object-contain transition-opacity duration-200 motion-reduce:transition-none ${opacity}`}
		/>
	);
	return (
		<Tile
			sessionId={sessionId}
			chip={chip}
			restored={restored}
			kind="MessageAttachmentsImage"
			status="Processing image"
		>
			{pending ? (
				img
			) : (
				<span
					data-cds="CardLink"
					role="button"
					tabIndex={0}
					onClick={(event) => {
						event.preventDefault();
						onOpen(chip, imgRef.current);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onOpen(chip, imgRef.current);
						}

						removeOnDeleteKey(event, sessionId, () => {
							removeChip(sessionId, chip);
						});
					}}
					className="outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-card-xs after:content-[''] cursor-zoom-in"
				>
					{img}
					<span className="sr-only">{label}</span>
				</span>
			)}
			{broken ? (
				<span
					data-attachment-glyph=""
					className={`pointer-events-none absolute inset-0 flex items-center justify-center text-ink-muted${pending ? " invisible" : ""}`}
				>
					<ImageIcon aria-hidden="true" className="size-5" />
				</span>
			) : null}
		</Tile>
	);
}

/** The upper-cased extension upstream's file tile shows in its Badge. */
function extensionBadge(name: string): string | undefined {
	const dot = name.lastIndexOf(".");
	return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : undefined;
}

/** Whether a file tile opens upstream's text preview: a settled upload with bytes and a text extension. */
function opensTextPreview(chip: ContextChip): boolean {
	return chip.file !== undefined && chip.status !== "pending" && isTextPreviewable(contextChipLabel(chip));
}

/**
 * An uploaded file as upstream's cds file tile: its name clamped to four
 * lines over an extension badge, with a CardLink when its text can preview.
 */
function FileChip({
	sessionId,
	chip,
	restored,
	onOpen,
}: {
	sessionId: string;
	chip: ContextChip;
	restored: boolean;
	onOpen: (chip: ContextChip, link: HTMLElement) => void;
}) {
	const label = contextChipLabel(chip);
	const badge = extensionBadge(label);
	return (
		<Tile
			sessionId={sessionId}
			chip={chip}
			restored={restored}
			kind="MessageAttachmentsFile"
			status="Uploading file"
		>
			{opensTextPreview(chip) ? (
				<span
					data-cds="CardLink"
					role="button"
					tabIndex={0}
					onClick={(event) => {
						event.preventDefault();
						onOpen(chip, event.currentTarget);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onOpen(chip, event.currentTarget);
						}

						removeOnDeleteKey(event, sessionId, () => {
							removeChip(sessionId, chip);
						});
					}}
					className="outline-none after:absolute after:inset-0 after:rounded-card-xs after:content-[''] cursor-pointer"
				>
					<span className="sr-only">{label}</span>
				</span>
			) : (
				<span className="sr-only">{label}</span>
			)}
			<div className="flex min-h-0 min-w-0 flex-1 flex-col justify-between gap-g5">
				<div className="flex min-w-0 flex-col">
					<span
						aria-hidden="true"
						title={label}
						className="text-footnote font-normal text-primary line-clamp-4 break-words [overflow-wrap:anywhere]"
					>
						<bdi>{label}</bdi>
					</span>
				</div>
				{badge === undefined ? null : (
					<span data-cds="Badge" className={BADGE_CLASS}>
						{badge}
					</span>
				)}
			</div>
		</Tile>
	);
}

/**
 * A transcript excerpt as upstream's cds quote tile: the text beside a rail,
 * clamped to five lines over an "Excerpt" badge, with a CardLink that opens it.
 */
function ExcerptChip({
	sessionId,
	chip,
	restored,
	onOpen,
}: {
	sessionId: string;
	chip: ContextChip;
	restored: boolean;
	onOpen: (chip: ContextChip, link: HTMLElement) => void;
}) {
	const text = chip.text ?? "";
	return (
		<Tile
			sessionId={sessionId}
			chip={chip}
			restored={restored}
			kind="MessageAttachmentsQuote"
			status=""
			name={text}
		>
			<span
				data-cds="CardLink"
				role="button"
				tabIndex={0}
				onClick={(event) => {
					event.preventDefault();
					onOpen(chip, event.currentTarget);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onOpen(chip, event.currentTarget);
					}

					removeOnDeleteKey(event, sessionId, () => {
						removeChip(sessionId, chip);
					});
				}}
				className="outline-none after:absolute after:inset-0 after:rounded-card-xs after:content-[''] cursor-pointer"
			>
				<span className="sr-only">{text}</span>
			</span>
			<ExcerptQuote text={text} label={contextChipLabel(chip)} />
		</Tile>
	);
}

interface TextPreview {
	title: string;
	text: string;
	variant: "excerpt" | "file";
}

/**
 * What a pill opens, after upstream's tray `dn`: a message is an unlabeled
 * snippet, so an "Excerpt"; a selection or terminal output is a labeled one,
 * a file preview titled by its label.
 */
function textPreviewOf(chip: ContextChip): TextPreview | null {
	if (chip.text === undefined) return null;
	if (chip.kind === "message" || chip.kind === "excerpt")
		return {title: "Excerpt", text: chip.text, variant: "excerpt"};
	if (chip.kind === "pasted-text") return {title: "Pasted text", text: chip.text, variant: "file"};
	if (chip.kind === "selection" || chip.kind === "terminal") {
		return {title: contextChipLabel(chip), text: chip.text, variant: "file"};
	}
	return null;
}

/** A pill's opener: upstream's CardLink, a focusable button with the default cursor. */
function PillLink({
	sessionId,
	onOpen,
	onRemove,
	children,
}: {
	sessionId: string;
	onOpen: (link: HTMLElement) => void;
	onRemove: () => void;
	children: ReactNode;
}) {
	return (
		<span
			data-cds="CardLink"
			role="button"
			tabIndex={0}
			onClick={(event) => {
				event.preventDefault();
				onOpen(event.currentTarget);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen(event.currentTarget);
				}
				removeOnDeleteKey(event, sessionId, onRemove);
			}}
			className="flex min-w-0 items-center gap-1 rounded-r5 outline-none focus-visible:shadow-focus"
		>
			{children}
		</span>
	);
}

/**
 * Upstream's attachments tray at the top of the card: ⇧⌘L context chips, uploaded images and long
 * pastes in attach order, then Changes pane comments, all waiting for the
 * next prompt and each removable.
 */
export function AttachedContextChips({
	sessionId,
	context,
	comments,
	cwd,
	restoredIds,
}: {
	sessionId: string;
	context: readonly ContextChip[];
	comments: readonly QueuedDiffComment[];
	/** The session's working directory: a path chip's right-click opens the file-actions menu. */
	cwd?: string | undefined;
	/**
	 * Chips staged before the composer mounted, which skip the enter motion and
	 * the scroll into view; by default, those present when this strip mounts.
	 */
	restoredIds?: ReadonlySet<string> | undefined;
}) {
	const [mountedIds] = useState<ReadonlySet<string>>(() => new Set(context.map((chip) => chip.id)));
	const restored = restoredIds ?? mountedIds;
	const rowRef = useRef<HTMLUListElement>(null);
	useEffect(() => {
		const row = rowRef.current;
		if (row === null) return undefined;
		const onFocusIn = (event: globalThis.FocusEvent) => {
			scrollFocusedTileIntoRow(row, event);
		};
		row.addEventListener("focusin", onFocusIn);
		return () => {
			row.removeEventListener("focusin", onFocusIn);
		};
	}, []);
	const [preview, setPreview] = useState<{chipId: string; origin: HTMLImageElement | null} | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const previewChip = preview === null ? undefined : context.find((chip) => chip.id === preview.chipId);
	const openPreview = (chip: ContextChip, origin: HTMLImageElement | null) => {
		opens.current += 1;
		setPreview({chipId: chip.id, origin});
		setPreviewOpen(true);
	};
	const [textPreview, setTextPreview] = useState<{
		chipId: string;
		opener: HTMLElement;
		/** An uploaded file's read text, titled by its name and sized by the whole file. */
		read?: TextPreview & {size: number};
	} | null>(null);
	const textPreviewChip = textPreview === null ? undefined : context.find((chip) => chip.id === textPreview.chipId);
	const textPreviewContent =
		textPreviewChip === undefined ? null : (textPreview?.read ?? textPreviewOf(textPreviewChip));
	// Upstream's `dt`: each open bumps it, so a file read that resolves after a later open is dropped.
	const opens = useRef(0);
	const openTextPreview = (chip: ContextChip, opener: HTMLElement) => {
		opens.current += 1;
		setTextPreview({chipId: chip.id, opener});
	};
	const openFilePreview = (chip: ContextChip, opener: HTMLElement) => {
		const {file} = chip;
		if (file === undefined) return;
		const open = (opens.current += 1);
		file.slice(0, TEXT_PREVIEW_LIMIT)
			.text()
			.then(
				(text) => {
					if (open !== opens.current) return;
					setTextPreview({
						chipId: chip.id,
						opener,
						read: {title: contextChipLabel(chip), text, variant: "file", size: file.size},
					});
				},
				() => {
					// An unreadable file opens nothing, as upstream's `Yi` swallows the error.
				},
			);
	};
	return (
		<div
			data-cds-composer-attachments-clip=""
			className="-mx-2 grid grid-rows-[1fr] overflow-hidden px-2 -mt-2 pt-2"
		>
			<div data-cds-composer-attachments="" className="min-h-0 min-w-0 px-1 pt-1 pb-2.5">
				<ul
					aria-label="Attached context"
					data-cds="MessageAttachments"
					data-cds-composer-attachments-row=""
					ref={rowRef}
					className="flex items-end gap-[6px] *:shrink-0 overflow-x-auto overscroll-x-contain scroll-fade-x p-2 pt-2.5 pe-2.5 -m-2 -mt-2.5 -me-2.5"
				>
					{context.map((chip) => {
						if (chip.kind === "image" && chip.previewUrl !== undefined) {
							return (
								<ImageChip
									key={chip.id}
									sessionId={sessionId}
									chip={chip}
									restored={restored.has(chip.id)}
									onOpen={openPreview}
								/>
							);
						}
						if (chip.kind === "file" && chip.name !== undefined) {
							return (
								<FileChip
									key={chip.id}
									sessionId={sessionId}
									chip={chip}
									restored={restored.has(chip.id)}
									onOpen={openFilePreview}
								/>
							);
						}
						if (chip.kind === "excerpt") {
							return (
								<ExcerptChip
									key={chip.id}
									sessionId={sessionId}
									chip={chip}
									restored={restored.has(chip.id)}
									onOpen={openTextPreview}
								/>
							);
						}
						const label = contextChipLabel(chip);
						const Icon = CONTEXT_CHIP_ICON[chip.kind];
						const content = (
							<>
								<Icon aria-hidden="true" className="size-3 shrink-0" />
								<span className="min-w-0 truncate text-primary">{label}</span>
							</>
						);
						const body = (
							<>
								{textPreviewOf(chip) === null ? (
									content
								) : (
									<PillLink
										sessionId={sessionId}
										onOpen={(opener) => {
											openTextPreview(chip, opener);
										}}
										onRemove={() => {
											removeChip(sessionId, chip);
										}}
									>
										{content}
									</PillLink>
								)}
								<button
									type="button"
									aria-label={`Remove ${label}`}
									{...removeButtonProps(sessionId, () => {
										removeChip(sessionId, chip);
									})}
									className={CHIP_REMOVE_CLASS}
								>
									<X aria-hidden="true" className="size-3" />
								</button>
							</>
						);
						const chipProps = {
							"data-chip-label": label,
							title: formatContextAttachment(chip),
							className: `self-end ${CHIP_CLASS}`,
						};
						// Upstream `Kt surface="composer"` with attach off: only a path chip has a file to act on.
						const filePath =
							chip.kind === "file" && chip.path !== undefined
								? absoluteMentionPath(chip.path, cwd)
								: null;
						if (cwd === undefined || filePath === null) {
							return (
								<li key={chip.id} {...chipProps}>
									{body}
								</li>
							);
						}
						return (
							<ContextMenu key={chip.id}>
								<ContextMenuTrigger render={<li />} {...chipProps}>
									{body}
								</ContextMenuTrigger>
								<MenuContent>
									<FileActionsMenuItems
										path={filePath}
										cwd={cwd}
										isDirectory={chip.path?.endsWith("/") === true}
										surface="composer"
										attach={false}
									/>
								</MenuContent>
							</ContextMenu>
						);
					})}
					{comments.map((comment) => {
						const label = chipLabel(comment);
						return (
							<li
								key={comment.id}
								data-chip-label={label}
								title={comment.text}
								className={`self-end ${CHIP_CLASS}`}
							>
								<MessageSquare aria-hidden="true" className="size-3 shrink-0" />
								<span className="shrink-0 text-primary">{label}</span>
								<span className="min-w-0 truncate">{comment.text}</span>
								<button
									type="button"
									aria-label={`Remove comment on ${label}`}
									{...removeButtonProps(sessionId, () => {
										removeQueuedDiffComment(sessionId, comment.id);
									})}
									className={CHIP_REMOVE_CLASS}
								>
									<X aria-hidden="true" className="size-3" />
								</button>
							</li>
						);
					})}
				</ul>
			</div>
			{preview !== null && previewChip?.previewUrl !== undefined ? (
				<Suspense fallback={null}>
					<ImagePreviewModal
						key={preview.chipId}
						src={previewChip.previewUrl}
						alt={contextChipLabel(previewChip)}
						open={previewOpen}
						origin={preview.origin}
						onClose={() => {
							setPreviewOpen(false);
						}}
					/>
				</Suspense>
			) : null}
			{textPreview !== null && textPreviewContent !== null ? (
				<Suspense fallback={null}>
					<TextPreviewDialog
						key={textPreview.chipId}
						open
						{...textPreviewContent}
						onClose={() => {
							setTextPreview(null);
						}}
						finalFocus={() => (textPreview.opener.isConnected ? textPreview.opener : true)}
					/>
				</Suspense>
			) : null}
		</div>
	);
}
