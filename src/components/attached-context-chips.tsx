import {lazy, type MouseEvent, type ReactNode, Suspense, useRef, useState} from "react";
import {
	FileText,
	Image as ImageIcon,
	MessageSquare,
	MessageSquareText,
	SquareTerminal,
	TextQuote,
	X,
} from "lucide-react";

import {type ContextChip, contextChipLabel, formatContextAttachment, removeContextChip} from "../lib/context-attach";
import {type QueuedDiffComment, removeQueuedDiffComment} from "../lib/diff-comments";
import {Skeleton} from "./ui/skeleton";

// The preview loads only when a tile opens, keeping its dialog out of the composer chunk.
const ImagePreviewModal = lazy(async () =>
	import("./image-preview-modal").then((module) => ({default: module.ImagePreviewModal})),
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
 * Upstream's `zn`: when the item being removed holds focus, hand it to the
 * next item, else the previous one, so it isn't lost to the body.
 */
function handOffFocus(item: Element | null): void {
	const active = item?.ownerDocument.activeElement;
	if (item === null || !(active instanceof HTMLElement) || !item.contains(active)) return;
	for (let next = item.nextElementSibling; next !== null; next = next.nextElementSibling) {
		const target = focusTarget(next);
		if (target !== null) {
			target.focus();
			return;
		}
	}
	for (let previous = item.previousElementSibling; previous !== null; previous = previous.previousElementSibling) {
		const target = focusTarget(previous);
		if (target !== null) {
			target.focus();
			return;
		}
	}
}

/** Upstream's `Vn`: a pointer press on a remove button doesn't take focus, so the editor keeps it. */
function keepFocusOnPointerRemove(event: MouseEvent<HTMLButtonElement>): void {
	event.preventDefault();
}

/** Runs a remove click after handing focus off from the item it removes. */
function removeHandler(remove: () => void) {
	return (event: MouseEvent<HTMLButtonElement>) => {
		handOffFocus(event.currentTarget.closest("li"));
		remove();
	};
}

function removeChip(sessionId: string, chip: ContextChip): void {
	if (chip.previewUrl !== undefined && typeof URL.revokeObjectURL === "function") {
		URL.revokeObjectURL(chip.previewUrl);
	}
	removeContextChip(sessionId, chip.id);
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

/** Upstream's cds MessageAttachments tile root: 120px, revealing its remove button on hover or focus. */
const TILE_CLASS =
	"group/tile relative isolate size-[7.5rem] shrink-0 rounded-r7 outline-none focus-visible:shadow-focus";

/** Upstream's xs Card: a hairline border-strong ring that turns into the focus ring for a focused CardLink. */
const CARD_CLASS =
	"group/card relative isolate flex flex-col rounded-card-xs after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-card-ring after:content-[''] has-[[data-cds=CardLink]:focus-visible]:after:shadow-focus size-full [--card-ring-color:var(--upstream-border-strong)]";

const CARD_FILL_CLASS =
	"cds-card-fill pointer-events-none absolute inset-0 -z-[1] m-0 rounded-[inherit] bg-surface-3 shadow-field-drop";

const CARD_BODY_CLASS = "cds-card-body flex min-h-0 flex-1 flex-col self-stretch rounded-[inherit] p-p7";

const TILE_REMOVE_CLASS =
	"absolute -end-2 -top-2 z-[1] inline-flex size-5 cursor-pointer items-center justify-center rounded-full bg-surface-3 text-secondary shadow-card-ring hover:text-primary outline-none focus-visible:shadow-focus before:absolute before:-inset-0.5 before:content-[''] opacity-0 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 group-has-[:focus-visible]/tile:opacity-100 touch:opacity-100";

const BADGE_CLASS =
	"inline-flex h-5 min-w-0 max-w-full shrink-0 items-center gap-1 self-start whitespace-nowrap rounded-full bg-fill-ghost-hover px-2 align-middle font-sans text-caption font-medium text-secondary";

/** Upstream's tile shell: Card, fill, body, the corner remove button and the pending status. */
function Tile({
	sessionId,
	chip,
	kind,
	status,
	children,
}: {
	sessionId: string;
	chip: ContextChip;
	kind: "MessageAttachmentsImage" | "MessageAttachmentsFile";
	status: string;
	children: ReactNode;
}) {
	const label = contextChipLabel(chip);
	const pending = chip.status === "pending";
	return (
		<li
			data-chip-label={label}
			data-cds={kind}
			data-cds-attachment=""
			tabIndex={-1}
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
				aria-label={`Remove ${label}`}
				onMouseDown={keepFocusOnPointerRemove}
				onClick={removeHandler(() => {
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
	onOpen,
}: {
	sessionId: string;
	chip: ContextChip;
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
			alt=""
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
		<Tile sessionId={sessionId} chip={chip} kind="MessageAttachmentsImage" status="Processing image">
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

/** An uploaded file as upstream's cds file tile: its name clamped to four lines over an extension badge. */
function FileChip({sessionId, chip}: {sessionId: string; chip: ContextChip}) {
	const label = contextChipLabel(chip);
	const badge = extensionBadge(label);
	return (
		<Tile sessionId={sessionId} chip={chip} kind="MessageAttachmentsFile" status="Uploading file">
			<span className="sr-only">{label}</span>
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
 * Upstream's attachments tray at the top of the card: ⇧⌘L context chips, uploaded images and long
 * pastes in attach order, then Changes pane comments, all waiting for the
 * next prompt and each removable.
 */
export function AttachedContextChips({
	sessionId,
	context,
	comments,
}: {
	sessionId: string;
	context: readonly ContextChip[];
	comments: readonly QueuedDiffComment[];
}) {
	const [preview, setPreview] = useState<{chipId: string; origin: HTMLImageElement | null} | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const previewChip = preview === null ? undefined : context.find((chip) => chip.id === preview.chipId);
	const openPreview = (chip: ContextChip, origin: HTMLImageElement | null) => {
		setPreview({chipId: chip.id, origin});
		setPreviewOpen(true);
	};
	return (
		<div
			data-cds-composer-attachments-clip=""
			className="-mx-2 grid grid-rows-[1fr] overflow-hidden px-2 -mt-2 pt-2"
		>
			<div data-cds-composer-attachments="" className="min-h-0 min-w-0 px-1 pt-1 pb-2.5">
				<ul aria-label="Attached context" className="flex w-full flex-wrap gap-[6px] justify-start">
					{context.map((chip) => {
						if (chip.kind === "image" && chip.previewUrl !== undefined) {
							return <ImageChip key={chip.id} sessionId={sessionId} chip={chip} onOpen={openPreview} />;
						}
						if (chip.kind === "file" && chip.name !== undefined) {
							return <FileChip key={chip.id} sessionId={sessionId} chip={chip} />;
						}
						const label = contextChipLabel(chip);
						const Icon = CONTEXT_CHIP_ICON[chip.kind];
						return (
							<li
								key={chip.id}
								data-chip-label={label}
								title={formatContextAttachment(chip)}
								className={`self-end ${CHIP_CLASS}`}
							>
								<Icon aria-hidden="true" className="size-3 shrink-0" />
								<span className="min-w-0 truncate text-primary">{label}</span>
								<button
									type="button"
									aria-label={`Remove ${label}`}
									onMouseDown={keepFocusOnPointerRemove}
									onClick={removeHandler(() => {
										removeChip(sessionId, chip);
									})}
									className={CHIP_REMOVE_CLASS}
								>
									<X aria-hidden="true" className="size-3" />
								</button>
							</li>
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
									onMouseDown={keepFocusOnPointerRemove}
									onClick={removeHandler(() => {
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
		</div>
	);
}
