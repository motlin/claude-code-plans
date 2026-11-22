import
{
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {Check, ChevronDown, ChevronUp, CornerDownLeft, Pencil, X} from "lucide-react";
import
{
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useDndContext,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import
{
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {CSS} from "@dnd-kit/utilities";

import {type QueuedPrompt, queueBandExpanded, queuedPreview, setQueueBandExpanded} from "../lib/composer-queue";
import {useAnnouncement} from "../lib/landed-store";
import {clampQueueDragToList, queuedDragEnd, queuedRowMask} from "../lib/queued-reorder";
import {useReducedMotion} from "../lib/reduced-motion";
import {Icon} from "./ui/icon";
import {Spinner} from "./ui/spinner";
import {ContextMenu, ContextMenuTrigger, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "./ui/menu";

const SEND_NOW_DESCRIPTION = "Stops Claude’s current response.";

/** Upstream's ghost icon buttons (size base): they never take focus from the composer on press. */
const BAND_BUTTON_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

function keepComposerFocus(event: MouseEvent)
{
	event.preventDefault();
}

const NO_IDS: ReadonlySet<string> = new Set();

/** Upstream's `he` + `Fo`: an accepted promote's ✓ "Sent" chip in place of Send now (`base` band, `sm` row). */
function QueuedRowSent({size}: {size: "base" | "sm"})
{
	return (
		<span
			data-testid="queued-row-sent"
			className={`flex shrink-0 items-center px-xs text-body text-muted-as-secondary epitaxy-hint-fade-in ${size === "base" ? "h-control" : "h-5"}`}
		>
			<span className="inline-flex items-center gap-0.75">
				<span className="epitaxy-check-draw inline-flex">
					<Check aria-hidden="true" className="size-4" />
				</span>
				Sent
			</span>
		</span>
	);
}

/**
 * Upstream's `${sessionId}:queued-status` (`NSe`): one persistent sr-only status that says "Sent"
 * when a promote is accepted and "Read" once it lands, for announcements newer than its mount.
 */
export function QueuedPromoteStatus({sessionId}: {sessionId: string})
{
	const announcement = useAnnouncement(sessionId);
	const [mountedSeq] = useState(() => announcement?.seq ?? 0);
	let text = "";
	if (announcement !== undefined && announcement.seq > mountedSeq)
		text = announcement.kind === "sent" ? "Sent" : "Read";
	return (
		<span role="status" className="sr-only" data-queued-promote-status="">
			{text}
		</span>
	);
}

export interface QueuedMessageBarProps
{
	/** Keys the remembered expansion, like upstream's per-session queue store. */
	sessionId: string;
	items: readonly QueuedPrompt[];
	/** Entries whose Send now was accepted: each shows ✓ Sent instead of Send now until it leaves. */
	acceptedIds?: ReadonlySet<string>;
	onEdit: (item: QueuedPrompt) => void;
	/** Settles when the interrupt request does; Send now stays busy until then. Absent: no Send now (upstream `onSteer`). */
	onSendNow?: ((id: string) => Promise<void>) | undefined;
	onRemove: (id: string) => void;
	/** Absent: no Clear all footer, as upstream gates it on `onClearAll`. */
	onClearAll?: (() => void) | undefined;
	/** Drag reorder of the expanded rows (upstream's `onReorder`); absent, rows have no handle. */
	onReorder?: ((id: string, overId: string) => void) | undefined;
	/** Upstream's `joinTop`: the band hangs under another band (the parked notice), squaring and bordering its top. */
	joinTop?: boolean;
}

const NO_ITEMS: readonly QueuedPrompt[] = [];

/**
 * claude.ai/code's `QueuedMessageBar`: the band above the composer listing messages queued for
 * after the current turn. One entry is a single row with inline Send now / Edit / Remove; two or
 * more collapse to "N messages queued · Next: …" and expand into a list with per-row menus and
 * Clear all. When the last entry leaves, the band plays its exit animation before unmounting.
 */
export function QueuedMessageBar({
	sessionId,
	items,
	acceptedIds = NO_IDS,
	onEdit,
	onSendNow,
	onRemove,
	onClearAll,
	onReorder,
	joinTop = false,
}: QueuedMessageBarProps)
{
	const [lastItems, setLastItems] = useState(items);
	if (items.length > 0 && items !== lastItems) setLastItems(items);
	const exiting = items.length === 0 && lastItems.length > 0;
	const shown = exiting ? lastItems : items;

	const [expanded, setExpandedState] = useState(() => queueBandExpanded(sessionId));
	const setExpanded = useCallback(
		(next: boolean) =>
		{
			setQueueBandExpanded(sessionId, next);
			setExpandedState(next);
		},
		[sessionId],
	);

	// When a toggle had focus, focus follows to the toggle that replaces it.
	const moveFocusRef = useRef(false);
	const toggle = (event: MouseEvent<HTMLButtonElement>, next: boolean) =>
	{
		moveFocusRef.current = event.currentTarget.ownerDocument.activeElement === event.currentTarget;
		setExpanded(next);
	};
	const receiveFocus = useCallback((element: HTMLButtonElement | null) =>
	{
		if (element === null || !moveFocusRef.current) return;
		moveFocusRef.current = false;
		element.focus();
	}, []);

	const sendNowDescriptionId = useId();
	const [sending, setSending] = useState(false);
	const sendFirstNow = (id: string) =>
	{
		if (sending || onSendNow === undefined) return;
		setSending(true);
		void onSendNow(id).finally(() =>
		{
			setSending(false);
		});
	};

	if (shown.length === 0) return null;

	const count = `${shown.length} ${shown.length === 1 ? "message" : "messages"} queued`;
	const first = shown[0];
	const join = joinTop ? " rounded-t-none border-t" : "";

	let band;
	if (shown.length === 1 && first !== undefined)
	{
		band = (
			<div
				data-take-back-entry=""
				data-perf-pending-prompt=""
				className={`flex items-center gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 px-3 select-none${join}`}
			>
				<span className="shrink-0 text-body font-medium text-primary">{count}</span>
				<span className="min-w-0 flex-1 truncate text-body text-secondary">{queuedPreview(first.text)}</span>
				{onSendNow === undefined ? null : acceptedIds.has(first.id) && !exiting ? (
					<QueuedRowSent size="base" />
				) : (
					<button
						type="button"
						aria-label="Send now"
						aria-describedby={sendNowDescriptionId}
						aria-busy={sending ? true : undefined}
						aria-disabled={sending ? true : undefined}
						className={`relative ${BAND_BUTTON_CLASS}`}
						onMouseDown={keepComposerFocus}
						onClick={() =>
						{
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
				)}
				{onSendNow !== undefined && (
					<span id={sendNowDescriptionId} hidden>
						{SEND_NOW_DESCRIPTION}
					</span>
				)}
				<button
					type="button"
					aria-label="Edit in composer"
					className={BAND_BUTTON_CLASS}
					onMouseDown={keepComposerFocus}
					onClick={() =>
					{
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
					onClick={() =>
					{
						onRemove(first.id);
					}}
				>
					<X aria-hidden="true" className="size-4" />
				</button>
			</div>
		);
	}
	else if (!expanded && first !== undefined)
	{
		band = (
			<button
				ref={receiveFocus}
				type="button"
				aria-expanded={false}
				className={`flex items-center gap-1.25 w-full min-w-0 min-h-[calc(var(--cds-h-control)+16px)] px-lg rounded-card bg-alpha-1 select-none text-start cursor-pointer hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus hover:bg-alpha-2${join}`}
				onClick={(event) =>
				{
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
	}
	else
	{
		band = (
			<div
				className={`flex flex-col w-full rounded-card bg-alpha-1 select-none overflow-clip divide-y divide-border${join}`}
			>
				<div className="flex items-center gap-1.25 w-full min-h-[calc(var(--cds-h-control)+16px)] px-lg">
					<span className="min-w-0 flex-1 text-body font-medium text-primary">{count}</span>
					<button
						ref={receiveFocus}
						type="button"
						aria-label="Collapse queued messages"
						aria-expanded={true}
						className={BAND_BUTTON_CLASS}
						onClick={(event) =>
						{
							toggle(event, false);
						}}
					>
						<ChevronUp aria-hidden="true" className="size-4" />
					</button>
				</div>
				<QueuedList items={shown} onReorder={onReorder}>
					{shown.map((item, index) => (
						<QueuedRow
							key={item.id}
							item={item}
							separated={index > 0}
							sortable={onReorder !== undefined && item.midTurn !== true}
							accepted={acceptedIds.has(item.id) && !exiting}
							onEdit={onEdit}
							onSendNow={onSendNow}
							onRemove={onRemove}
						/>
					))}
				</QueuedList>
				{onClearAll !== undefined && (
					<div className="flex justify-end px-lg py-sm">
						<span
							role="button"
							tabIndex={0}
							className="cursor-pointer text-footnote text-danger-000 hover:underline hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
							onClick={() =>
							{
								onClearAll();
							}}
							onKeyDown={(event: KeyboardEvent) =>
							{
								if (event.key !== "Enter" && event.key !== " ") return;
								event.preventDefault();
								onClearAll();
							}}
						>
							Clear all
						</span>
					</div>
				)}
			</div>
		);
	}

	return (
		<div
			className={exiting ? "band-enter band-exit" : "band-enter"}
			inert={exiting}
			onAnimationEnd={(event) =>
			{
				if (exiting && event.target === event.currentTarget) setLastItems(NO_ITEMS);
			}}
		>
			{band}
		</div>
	);
}

/**
 * The expanded band's `role=list`. With `onReorder` it is upstream's sortable list: dnd-kit with a 5px
 * pointer activation, the sortable keyboard sensor, closestCenter, the clamp-to-list modifier, no
 * auto-scroll and dnd-kit's default screen-reader text. While a row is held the body shows `grabbing`
 * and can't select; dropping, cancelling, collapsing and unmounting all restore it.
 */
function QueuedList({
	items,
	onReorder,
	children,
}: {
	items: readonly QueuedPrompt[];
	onReorder: ((id: string, overId: string) => void) | undefined;
	children: ReactNode;
})
{
	const sensors = useSensors(
		useSensor(
			PointerSensor,
			{
				activationConstraint:
				{
					distance: 5,
				},
			},
		),
		useSensor(
			KeyboardSensor,
			{
				coordinateGetter: sortableKeyboardCoordinates,
			},
		),
	);
	const listRef = useRef<HTMLDivElement>(null);
	const heldBodyRef = useRef<HTMLElement | null>(null);
	const releaseBody = useCallback(() =>
	{
		const body = heldBodyRef.current;
		if (body === null) return;
		heldBodyRef.current = null;
		body.style.cursor = "";
		body.style.userSelect = "";
	}, []);
	useEffect(() => releaseBody, [releaseBody]);

	const list = (
		<div
			ref={listRef}
			role="list"
			aria-label="Queued messages"
			className="flex flex-col max-h-[min(40vh,22rem)] overflow-y-auto overscroll-contain p-xs"
		>
			{children}
		</div>
	);
	if (onReorder === undefined) return list;
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			modifiers={[clampQueueDragToList]}
			autoScroll={false}
			onDragStart={() =>
			{
				const body = listRef.current?.ownerDocument.body;
				if (body === undefined) return;
				heldBodyRef.current = body;
				body.style.cursor = "grabbing";
				body.style.userSelect = "none";
			}}
			onDragCancel={releaseBody}
			onDragEnd={(event) =>
			{
				releaseBody();
				queuedDragEnd(event, onReorder);
			}}
		>
			<SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
				{list}
			</SortableContext>
		</DndContext>
	);
}

/** Upstream's row action visibility (handle and ⋯): shown while held, hidden while another row drags. */
function rowActionsClass(held: boolean, dragActive: boolean): string
{
	if (held) return "";
	if (dragActive) return "opacity-0";
	return "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100";
}

function QueuedRowItems({
	item,
	onEdit,
	onSendNow,
	onRemove,
}: {
	item: QueuedPrompt;
	onEdit: (item: QueuedPrompt) => void;
	onSendNow: ((id: string) => Promise<void>) | undefined;
	onRemove: (id: string) => void;
})
{
	return (
		<>
			<MenuItem
				onSelect={() =>
				{
					onEdit(item);
				}}
			>
				Edit in composer
			</MenuItem>
			{onSendNow !== undefined && (
				<MenuItem
					onSelect={() =>
					{
						void onSendNow(item.id);
					}}
				>
					Send now
				</MenuItem>
			)}
			<MenuSeparator />
			<MenuItem
				variant="danger"
				onSelect={() =>
				{
					onRemove(item.id);
				}}
			>
				Remove from queue
			</MenuItem>
		</>
	);
}

function QueuedRow({
	item,
	separated,
	sortable,
	accepted,
	onEdit,
	onSendNow,
	onRemove,
}: {
	item: QueuedPrompt;
	separated: boolean;
	sortable: boolean;
	accepted: boolean;
	onEdit: (item: QueuedPrompt) => void;
	onSendNow: ((id: string) => Promise<void>) | undefined;
	onRemove: (id: string) => void;
})
{
	// Upstream's `se`: the row's DotsVertical stays shown while its right-click menu is open.
	const [contextOpen, setContextOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const reducedMotion = useReducedMotion();
	const dragActive = useDndContext().active !== null;
	const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging} = useSortable(
		{
			id: item.id,
			disabled:
			{
				draggable: !sortable,
				droppable: !sortable,
			},
			...(reducedMotion
				?
					{
						transition: null,
					}
				: {}),
		},
	);
	const held = isDragging || contextOpen || menuOpen;
	const actionsClass = rowActionsClass(held, dragActive);
	const mask = queuedRowMask(
		{
			sortable,
			held,
			otherDragging: dragActive && !isDragging,
		},
	);
	const actions =
	{
		item,
		onEdit,
		onSendNow,
		onRemove,
	};
	return (
		<>
			{separated && <div role="presentation" aria-hidden="true" className="border-t border-border" />}
			{/* Upstream renders each row as a `ContextMenu.Trigger` carrying the listitem attributes. */}
			<ContextMenu onOpenChange={setContextOpen}>
				<ContextMenuTrigger
					ref={setNodeRef}
					render={<div />}
					role="listitem"
					data-take-back-entry={item.id}
					data-perf-pending-prompt=""
					style={
					{
						transform: CSS.Translate.toString(transform),
						transition,
					}}
					className={`group/row relative flex items-start gap-1.25 min-w-0 p-1.25 rounded${isDragging ? " bg-alpha-2 opacity-80" : ""}`}
				>
					<span
						className={`min-w-0 flex-1 text-body line-clamp-2 select-text text-primary break-words whitespace-pre-wrap ${mask}`}
					>
						{item.text}
					</span>
					<div className="absolute end-1.25 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
						{accepted && <QueuedRowSent size="sm" />}
						{sortable && (
							<button
								ref={setActivatorNodeRef}
								type="button"
								aria-label="Reorder queued message"
								{...attributes}
								{...listeners}
								className={`shrink-0 grid h-5 w-5 place-items-center ${dragActive ? "cursor-grabbing text-primary" : "cursor-grab active:cursor-grabbing text-muted-as-secondary hover:text-primary"} ${actionsClass}`}
							>
								<Icon name="Reorder" size="sm" />
							</button>
						)}
						<Menu onOpenChange={setMenuOpen}>
							<MenuTrigger
								aria-label="Queued message actions"
								className={`flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary ${actionsClass}${dragActive ? " pointer-events-none" : ""}`}
							>
								<Icon name="DotsVertical" size="sm" className="size-3.5" />
							</MenuTrigger>
							<MenuContent side="bottom" align="end">
								<QueuedRowItems {...actions} />
							</MenuContent>
						</Menu>
					</div>
				</ContextMenuTrigger>
				<MenuContent>
					<QueuedRowItems {...actions} />
				</MenuContent>
			</ContextMenu>
		</>
	);
}
