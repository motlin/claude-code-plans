import {type KeyboardEvent, type MouseEvent, useCallback, useId, useRef, useState} from "react";
import {ChevronDown, ChevronUp, CornerDownLeft, EllipsisVertical, Pencil, X} from "lucide-react";

import {type QueuedPrompt, queueBandExpanded, queuedPreview, setQueueBandExpanded} from "../lib/composer-queue";
import {Spinner} from "./ui/spinner";
import {Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "./ui/menu";

const SEND_NOW_DESCRIPTION = "Stops Claude’s current response.";

/** Upstream's ghost icon buttons (size base): they never take focus from the composer on press. */
const BAND_BUTTON_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

function keepComposerFocus(event: MouseEvent) {
	event.preventDefault();
}

export interface QueuedMessageBarProps {
	/** Keys the remembered expansion, like upstream's per-session queue store. */
	sessionId: string;
	items: readonly QueuedPrompt[];
	onEdit: (item: QueuedPrompt) => void;
	/** Settles when the interrupt request does; Send now stays busy until then. */
	onSendNow: (id: string) => Promise<void>;
	onRemove: (id: string) => void;
	onClearAll: () => void;
}

const NO_ITEMS: readonly QueuedPrompt[] = [];

/**
 * claude.ai/code's `QueuedMessageBar`: the band above the composer listing messages queued for
 * after the current turn. One entry is a single row with inline Send now / Edit / Remove; two or
 * more collapse to "N messages queued · Next: …" and expand into a list with per-row menus and
 * Clear all. When the last entry leaves, the band plays its exit animation before unmounting.
 */
export function QueuedMessageBar({sessionId, items, onEdit, onSendNow, onRemove, onClearAll}: QueuedMessageBarProps) {
	const [lastItems, setLastItems] = useState(items);
	if (items.length > 0 && items !== lastItems) setLastItems(items);
	const exiting = items.length === 0 && lastItems.length > 0;
	const shown = exiting ? lastItems : items;

	const [expanded, setExpandedState] = useState(() => queueBandExpanded(sessionId));
	const setExpanded = useCallback(
		(next: boolean) => {
			setQueueBandExpanded(sessionId, next);
			setExpandedState(next);
		},
		[sessionId],
	);

	// When a toggle had focus, focus follows to the toggle that replaces it.
	const moveFocusRef = useRef(false);
	const toggle = (event: MouseEvent<HTMLButtonElement>, next: boolean) => {
		moveFocusRef.current = event.currentTarget.ownerDocument.activeElement === event.currentTarget;
		setExpanded(next);
	};
	const receiveFocus = useCallback((element: HTMLButtonElement | null) => {
		if (element === null || !moveFocusRef.current) return;
		moveFocusRef.current = false;
		element.focus();
	}, []);

	const sendNowDescriptionId = useId();
	const [sending, setSending] = useState(false);
	const sendFirstNow = (id: string) => {
		if (sending) return;
		setSending(true);
		void onSendNow(id).finally(() => {
			setSending(false);
		});
	};

	if (shown.length === 0) return null;

	const count = `${shown.length} ${shown.length === 1 ? "message" : "messages"} queued`;
	const first = shown[0];

	let band;
	if (shown.length === 1 && first !== undefined) {
		band = (
			<div
				data-take-back-entry=""
				data-perf-pending-prompt=""
				className="flex items-center gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 px-3 select-none"
			>
				<span className="shrink-0 text-body font-medium text-primary">{count}</span>
				<span className="min-w-0 flex-1 truncate text-body text-secondary">{queuedPreview(first.text)}</span>
				<button
					type="button"
					aria-label="Send now"
					aria-describedby={sendNowDescriptionId}
					aria-busy={sending ? true : undefined}
					aria-disabled={sending ? true : undefined}
					className={`relative ${BAND_BUTTON_CLASS}`}
					onMouseDown={keepComposerFocus}
					onClick={() => {
						sendFirstNow(first.id);
					}}
				>
					<CornerDownLeft aria-hidden="true" className={sending ? "size-4 opacity-0" : "size-4"} />
					{sending && (
						<span className="absolute inset-0 grid place-items-center leading-[0]">
							<Spinner size="sm" label="Sending…" />
						</span>
					)}
				</button>
				<span id={sendNowDescriptionId} hidden>
					{SEND_NOW_DESCRIPTION}
				</span>
				<button
					type="button"
					aria-label="Edit in composer"
					className={BAND_BUTTON_CLASS}
					onMouseDown={keepComposerFocus}
					onClick={() => {
						onEdit(first);
					}}
				>
					<Pencil aria-hidden="true" className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Remove from queue"
					className={BAND_BUTTON_CLASS}
					onMouseDown={keepComposerFocus}
					onClick={() => {
						onRemove(first.id);
					}}
				>
					<X aria-hidden="true" className="size-4" />
				</button>
			</div>
		);
	} else if (!expanded && first !== undefined) {
		band = (
			<button
				ref={receiveFocus}
				type="button"
				aria-expanded={false}
				className="flex items-center gap-1.25 w-full min-w-0 min-h-10 px-3 rounded-card bg-alpha-1 select-none text-start cursor-pointer hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus hover:bg-alpha-2"
				onClick={(event) => {
					toggle(event, true);
				}}
			>
				<span className="text-body font-medium text-primary">{count}</span>
				<span className="min-w-0 flex-1 truncate text-body text-secondary">
					Next: {queuedPreview(first.text)}
				</span>
				<span className="grid size-6 shrink-0 place-items-center text-secondary">
					<ChevronDown aria-hidden="true" className="size-4" />
				</span>
			</button>
		);
	} else {
		band = (
			<div className="flex flex-col w-full rounded-card bg-alpha-1 select-none overflow-clip divide-y divide-border">
				<div className="flex items-center gap-1.25 w-full min-h-10 px-3">
					<span className="min-w-0 flex-1 text-body font-medium text-primary">{count}</span>
					<button
						ref={receiveFocus}
						type="button"
						aria-label="Collapse queued messages"
						aria-expanded={true}
						className={BAND_BUTTON_CLASS}
						onClick={(event) => {
							toggle(event, false);
						}}
					>
						<ChevronUp aria-hidden="true" className="size-4" />
					</button>
				</div>
				<div
					role="list"
					aria-label="Queued messages"
					className="flex flex-col max-h-[min(40vh,22rem)] overflow-y-auto overscroll-contain p-1"
				>
					{shown.map((item, index) => (
						<QueuedRow
							key={item.id}
							item={item}
							separated={index > 0}
							onEdit={onEdit}
							onSendNow={onSendNow}
							onRemove={onRemove}
						/>
					))}
				</div>
				<div className="flex justify-end px-3 py-2">
					<span
						role="button"
						tabIndex={0}
						className="cursor-pointer text-footnote text-danger-000 hover:underline hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
						onClick={() => {
							onClearAll();
						}}
						onKeyDown={(event: KeyboardEvent) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							onClearAll();
						}}
					>
						Clear all
					</span>
				</div>
			</div>
		);
	}

	return (
		<div
			className={exiting ? "band-enter band-exit" : "band-enter"}
			inert={exiting}
			onAnimationEnd={(event) => {
				if (exiting && event.target === event.currentTarget) setLastItems(NO_ITEMS);
			}}
		>
			{band}
		</div>
	);
}

function QueuedRow({
	item,
	separated,
	onEdit,
	onSendNow,
	onRemove,
}: {
	item: QueuedPrompt;
	separated: boolean;
	onEdit: (item: QueuedPrompt) => void;
	onSendNow: (id: string) => Promise<void>;
	onRemove: (id: string) => void;
}) {
	return (
		<>
			{separated && <div role="presentation" aria-hidden="true" className="border-t border-border" />}
			<div
				role="listitem"
				data-take-back-entry=""
				data-perf-pending-prompt=""
				className="group/row relative flex items-start gap-1.25 min-w-0 p-1.25 rounded"
			>
				<span className="min-w-0 flex-1 text-body line-clamp-2 select-text text-primary break-words whitespace-pre-wrap group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%_-_76px),transparent_calc(100%_-_28px))] pointer-coarse:[mask-image:linear-gradient(to_right,black_calc(100%_-_76px),transparent_calc(100%_-_28px))]">
					{item.text}
				</span>
				<div className="absolute end-1.25 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
					<Menu>
						<MenuTrigger
							aria-label="Queued message actions"
							className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary opacity-0 transition-colors hover:bg-fill-ghost-hover hover:text-primary focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100 data-[popup-open]:opacity-100"
						>
							<EllipsisVertical aria-hidden="true" className="size-3.5" />
						</MenuTrigger>
						<MenuContent side="bottom" align="end">
							<MenuItem
								onSelect={() => {
									onEdit(item);
								}}
							>
								Edit in composer
							</MenuItem>
							<MenuItem
								onSelect={() => {
									void onSendNow(item.id);
								}}
							>
								Send now
							</MenuItem>
							<MenuSeparator />
							<MenuItem
								variant="danger"
								onSelect={() => {
									onRemove(item.id);
								}}
							>
								Remove from queue
							</MenuItem>
						</MenuContent>
					</Menu>
				</div>
			</div>
		</>
	);
}
