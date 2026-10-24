import {type KeyboardEvent, lazy, type MouseEvent, type ReactNode, Suspense, useRef, useState} from "react";
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
import {TEXT_PREVIEW_LIMIT} from "../lib/text-preview";
import {isTextPreviewable} from "../lib/text-preview-extensions";
import {FileActionsMenuItems} from "./files/file-actions-menu";
import {absoluteMentionPath} from "./files/mention-path";
import {ContextMenu, ContextMenuTrigger, MenuContent} from "./ui/menu";
import {Skeleton} from "./ui/skeleton";
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

/**
 * Upstream's `Fi`: Delete or Backspace on a focused CardLink removes its tile,
 * handing focus off first; modifiers, key repeat and IME composition don't.
 */
function removeOnDeleteKey(event: KeyboardEvent<HTMLElement>, remove: () => void): void {
	if (event.key !== "Delete" && event.key !== "Backspace") return;
	if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
	if (event.repeat || event.nativeEvent.isComposing) return;
	event.preventDefault();
	handOffFocus(event.currentTarget.closest("li"));
	remove();
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

						removeOnDeleteKey(event, () => {
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
	onOpen,
}: {
	sessionId: string;
	chip: ContextChip;
	onOpen: (chip: ContextChip, link: HTMLElement) => void;
}) {
	const label = contextChipLabel(chip);
	const badge = extensionBadge(label);
	return (
		<Tile sessionId={sessionId} chip={chip} kind="MessageAttachmentsFile" status="Uploading file">
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

						removeOnDeleteKey(event, () => {
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
	if (chip.kind === "selection" || chip.kind === "terminal") {
		return {title: contextChipLabel(chip), text: chip.text, variant: "file"};
	}
	return null;
}

/** A pill's opener: upstream's CardLink, a focusable button with the default cursor. */
function PillLink({
	onOpen,
	onRemove,
	children,
}: {
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
				removeOnDeleteKey(event, onRemove);
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
}: {
	sessionId: string;
	context: readonly ContextChip[];
	comments: readonly QueuedDiffComment[];
	/** The session's working directory: a path chip's right-click opens the file-actions menu. */
	cwd?: string | undefined;
}) {
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
				<ul aria-label="Attached context" className="flex w-full flex-wrap gap-[6px] justify-start">
					{context.map((chip) => {
						if (chip.kind === "image" && chip.previewUrl !== undefined) {
							return <ImageChip key={chip.id} sessionId={sessionId} chip={chip} onOpen={openPreview} />;
						}
						if (chip.kind === "file" && chip.name !== undefined) {
							return (
								<FileChip key={chip.id} sessionId={sessionId} chip={chip} onOpen={openFilePreview} />
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
									onMouseDown={keepFocusOnPointerRemove}
									onClick={removeHandler(() => {
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
