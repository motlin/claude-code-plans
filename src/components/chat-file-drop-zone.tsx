import {useEffect, useRef, useState, type DragEvent, type ReactNode} from "react";
import {splitDroppedItems} from "../lib/drop-collect";
import type {ChatFileDropHandler} from "./chat-file-drop-context";

/**
 * Upstream shared-41 `dZ` plus the badge's own classes (`c4c113f6f` `_`), verbatim. The tile vars and data attributes
 * aren't defined locally yet, so it resolves to an 8px inset inside the chat card. The fade's
 * `var(--cds-dur-base)_var(--cds-ease-out)` is spelled out because local has neither var.
 */
const CHAT_DROP_OVERLAY_CLASS =
	"dframe-drop-overlay-badge inset-0 motion-safe:animate-[cds-fade-in_0.2s_cubic-bezier(0.165,0.84,0.44,1)] start-[calc(8px-var(--tiles-padding,0px))] [[data-chat-gutter-start=shave]_&]:start-2 end-[calc(8px-var(--tiles-padding,0px))] [[data-chat-gutter-end]:not([data-pane-overlay])_&]:end-2 [[data-pane-overlay]_&]:end-[calc(8px-var(--epitaxy-overlay-rail-titlebar-shift,0px))] -bottom-[var(--tiles-padding,0px)] my-2 rounded-[var(--df-radius-card,8px)] [[data-tile-overflow-anchor=left]_&]:mr-[max(0px,var(--tile-overflow-min,0px)_-_100cqw)] [[data-tile-overflow-anchor=right]_&]:ml-[max(0px,var(--tile-overflow-min,0px)_-_100cqw)]";

/** Upstream's cds FileDropZone file-hint badge: a blurred, accent-ringed cover with a "Drop files here" pill. */
export function ChatDropOverlayBadge()
{
	return (
		<div
			aria-hidden="true"
			className={CHAT_DROP_OVERLAY_CLASS}
			style={
			{
				zIndex: 40,
			}}
		>
			<span className="dframe-drop-overlay-label">Drop files here</span>
		</div>
	);
}

function hasFiles(e: DragEvent): boolean
{
	return Array.from(e.dataTransfer.types).includes("Files");
}

function droppedFiles(e: DragEvent): File[]
{
	const {items, files} = e.dataTransfer;
	// Like upstream's `zt`, dropped folders are left out.
	return items.length > 0 ? splitDroppedItems(items, files).files : Array.from(files);
}

/**
 * Port of upstream `ca8b34310` `Uy`: React handlers on the zone track the entered nodes, claim Files drags with
 * preventDefault + stopPropagation, and while a drag is over the zone a document drop, dragend or pointerdown resets it.
 * A disabled zone still claims and swallows the drop, so the browser never opens the file, but shows nothing.
 */
function useChatFileDragOver({disabled, onDrop}: {disabled: boolean; onDrop: ChatFileDropHandler})
{
	const entered = useRef(new Set<Node>());
	const [over, setOver] = useState<Document | null>(null);

	useEffect(() =>
	{
		if (over === null) return undefined;
		const reset = () =>
		{
			entered.current.clear();
			setOver(null);
		};
		over.addEventListener("dragend", reset, true);
		over.addEventListener("drop", reset, true);
		over.addEventListener("pointerdown", reset, true);
		return () =>
		{
			over.removeEventListener("dragend", reset, true);
			over.removeEventListener("drop", reset, true);
			over.removeEventListener("pointerdown", reset, true);
		};
	}, [over]);

	const claim = (e: DragEvent) =>
	{
		e.preventDefault();
		e.stopPropagation();
	};

	return {
		isDragOver: over !== null && !disabled,
		handlers:
		{
			onDragEnter: (e: DragEvent<HTMLDivElement>) =>
			{
				if (!hasFiles(e)) return;
				claim(e);
				if (e.target instanceof Node) entered.current.add(e.target);
				setOver(e.currentTarget.ownerDocument);
			},
			onDragLeave: (e: DragEvent<HTMLDivElement>) =>
			{
				if (e.target instanceof Node) entered.current.delete(e.target);
				const zone = e.currentTarget;
				for (const node of entered.current) if (!zone.contains(node)) entered.current.delete(node);
				if (entered.current.size === 0) setOver(null);
			},
			onDragOver: (e: DragEvent<HTMLDivElement>) =>
			{
				if (!hasFiles(e)) return;
				claim(e);
				e.dataTransfer.dropEffect = disabled ? "none" : "copy";
			},
			onDrop: (e: DragEvent<HTMLDivElement>) =>
			{
				if (!hasFiles(e)) return;
				claim(e);
				entered.current.clear();
				setOver(null);
				if (disabled) return;
				const files = droppedFiles(e);
				if (files.length > 0) onDrop(files);
			},
		},
	};
}

/** Upstream's cds FileDropZone around the chat column (cc43287c9): files dragged over the column show the badge. */
export function ChatFileDropZone({
	onDrop,
	disabled,
	className,
	children,
}: {
	onDrop: ChatFileDropHandler;
	disabled: boolean;
	className: string;
	children: ReactNode;
})
{
	const {isDragOver, handlers} = useChatFileDragOver(
		{
			disabled,
			onDrop,
		},
	);
	return (
		<div className={`relative ${className}`} {...handlers}>
			{children}
			{isDragOver && <ChatDropOverlayBadge />}
		</div>
	);
}
