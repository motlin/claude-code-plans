import {useState} from "react";
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

function PendingOverlay({status}: {status: string}) {
	return (
		<>
			<span aria-hidden="true" className="contents">
				<Skeleton className="pointer-events-none absolute inset-0 size-full rounded-card" />
			</span>
			<span role="status" className="sr-only">
				{status}
			</span>
		</>
	);
}

/** An attached image as a thumbnail tile with its remove button in the corner. */
function ImageChip({sessionId, chip}: {sessionId: string; chip: ContextChip}) {
	const label = contextChipLabel(chip);
	const pending = chip.status === "pending";
	const [loaded, setLoaded] = useState(false);
	return (
		<li
			data-chip-label={label}
			data-cds="MessageAttachmentsImage"
			{...pendingProps(chip)}
			title={chip.path}
			className="relative size-12 shrink-0 overflow-hidden rounded-r6 border border-border bg-surface-3"
		>
			<img
				src={chip.previewUrl}
				alt={pending ? "" : label}
				onLoad={() => {
					setLoaded(true);
				}}
				className={`size-full object-cover transition-opacity motion-reduce:transition-none ${
					pending ? (loaded ? "opacity-50" : "opacity-0") : "opacity-100"
				}`}
			/>
			{pending ? <PendingOverlay status="Processing image" /> : null}
			<button
				type="button"
				aria-label={`Remove ${label}`}
				onClick={() => {
					removeChip(sessionId, chip);
				}}
				className="absolute end-0.5 top-0.5 z-[1] flex size-4 cursor-pointer items-center justify-center rounded-full bg-surface-3/90 text-secondary hover:text-primary"
			>
				<X aria-hidden="true" className="size-2.5" />
			</button>
		</li>
	);
}

/**
 * The strip above the card: ⇧⌘L context chips, uploaded images and long
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
	return (
		<ul aria-label="Attached context" className="mb-1.5 flex flex-wrap items-end gap-1">
			{context.map((chip) => {
				if (chip.kind === "image" && chip.previewUrl !== undefined) {
					return <ImageChip key={chip.id} sessionId={sessionId} chip={chip} />;
				}
				const label = contextChipLabel(chip);
				const Icon = CONTEXT_CHIP_ICON[chip.kind];
				return (
					<li
						key={chip.id}
						data-chip-label={label}
						{...(chip.kind === "file" && chip.name !== undefined
							? {"data-cds": "MessageAttachmentsFile"}
							: {})}
						{...pendingProps(chip)}
						title={chip.status === "pending" ? label : formatContextAttachment(chip)}
						className={`relative overflow-hidden ${CHIP_CLASS}`}
					>
						{chip.status === "pending" ? <PendingOverlay status="Uploading file" /> : null}
						<Icon aria-hidden="true" className="size-3 shrink-0" />
						<span className="min-w-0 truncate text-primary">{label}</span>
						<button
							type="button"
							aria-label={`Remove ${label}`}
							onClick={() => {
								removeChip(sessionId, chip);
							}}
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
					<li key={comment.id} data-chip-label={label} title={comment.text} className={CHIP_CLASS}>
						<MessageSquare aria-hidden="true" className="size-3 shrink-0" />
						<span className="shrink-0 text-primary">{label}</span>
						<span className="min-w-0 truncate">{comment.text}</span>
						<button
							type="button"
							aria-label={`Remove comment on ${label}`}
							onClick={() => {
								removeQueuedDiffComment(sessionId, comment.id);
							}}
							className={CHIP_REMOVE_CLASS}
						>
							<X aria-hidden="true" className="size-3" />
						</button>
					</li>
				);
			})}
		</ul>
	);
}
