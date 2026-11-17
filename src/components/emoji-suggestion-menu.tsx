import {useEffect, useLayoutEffect, useRef} from "react";

import type {EmojiItem} from "../lib/emoji-search";
import {EMOJI_MENU_WIDTH, emojiMenuPosition} from "../lib/emoji-trigger";
import {textareaCaretRect} from "../lib/textarea-caret";
import {emojiOptionId} from "./emoji-option-id";
import {useItemClass} from "./ui/menu-internals";
import {ViewportPortal} from "./viewport-portal";

/**
 * Upstream's popup Surface class minus the cds reset (local has no `cds-reset`/`draggable-none` utilities); it starts
 * `invisible` until the layout effect places it, as upstream's does.
 */
const POPUP_CLASS =
	"rounded-card bg-surface-3 shadow-panel forced-colors:border forced-colors:border-solid forced-colors:border-[color:CanvasText] fixed top-0 left-0 invisible flex flex-col text-body text-primary outline-none focus-visible:outline-hidden";

/** Upstream `bY` with its gutter overridden by `p-1`. */
const LIST_CLASS =
	"relative min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-y rounded-[inherit] border-b border-transparent forced-colors:border-b-0 p-1";

/** Upstream `NJ` default variant: local's menu row recipe follows the density (24px compact, 28px comfortable). */
const ROW_VARIANT_CLASS = "text-primary data-[highlighted]:bg-fill-ghost-hover";

/**
 * Local composer popups (`/` and `@`) layer at 130 so they clear the composer's own stacked chrome; upstream's base-layer
 * 60 would sit under them, so the emoji popup shares their layer.
 */
const POPUP_Z_INDEX = 130;

/**
 * The claude.ai/code `:shortcode` emoji popup (emoji-suggestion `G`): up to eight `:name:` rows, fixed to the viewport
 * above the `:` token (below when there is more room there). The textarea keeps focus and drives `highlighted`;
 * real pointer movement over a row commits it, leaving keeps it, and a click accepts.
 */
export function EmojiSuggestionMenu({
	id,
	items,
	highlighted,
	onHighlight,
	onAccept,
	textarea,
	start,
}: {
	id: string;
	items: readonly EmojiItem[];
	highlighted: number;
	onHighlight: (index: number) => void;
	onAccept: (item: EmojiItem) => void;
	textarea: HTMLTextAreaElement | null;
	/** Index of the `:` in the textarea. */
	start: number;
})
{
	const popupRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const rowClass = `${useItemClass()} ${ROW_VARIANT_CLASS}`;

	useEffect(() =>
	{
		listRef.current?.children[highlighted]?.scrollIntoView(
			{
				block: "nearest",
			},
		);
	}, [highlighted]);

	useLayoutEffect(() =>
	{
		const place = () =>
		{
			const popup = popupRef.current;
			if (popup === null) return;
			if (textarea === null)
			{
				popup.style.visibility = "hidden";
				return;
			}
			const box = textarea.getBoundingClientRect();
			const from = textareaCaretRect(textarea, start);
			const to = textareaCaretRect(textarea, textarea.selectionStart);
			const position = emojiMenuPosition(
				{
					caret:
					{
						top: box.top + from.top,
						left: box.left + from.left,
						right: box.left + to.left,
					},
					viewport:
					{
						width: window.innerWidth,
						height: window.innerHeight,
					},
					rtl: document.documentElement.dir === "rtl",
				},
			);
			popup.style.top = `${position.top}px`;
			popup.style.left = `${position.left}px`;
			popup.style.maxHeight = `${position.maxHeight}px`;
			popup.style.transform = position.transform;
			popup.style.visibility = "visible";
		};
		place();
		window.addEventListener("resize", place);
		textarea?.addEventListener("scroll", place);
		return () =>
		{
			window.removeEventListener("resize", place);
			textarea?.removeEventListener("scroll", place);
		};
	}, [textarea, start, items.length]);

	return (
		<ViewportPortal>
			{/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the composer textarea keeps focus and drives the list through aria-activedescendant */}
			<div
				ref={popupRef}
				id={id}
				data-cds="Surface"
				data-surface="popover"
				role="listbox"
				aria-label="Emoji suggestions"
				className={POPUP_CLASS}
				style={
				{
					width: EMOJI_MENU_WIDTH,
					zIndex: POPUP_Z_INDEX,
				}}
				onMouseDown={(e) =>
				{
					e.preventDefault();
				}}
			>
				<div ref={listRef} className={LIST_CLASS}>
					{items.map((item, index) => (
						<button
							key={item.name}
							type="button"
							tabIndex={-1}
							id={emojiOptionId(id, index)}
							role="option"
							aria-selected={index === highlighted}
							data-highlighted={index === highlighted ? "" : undefined}
							className={rowClass}
							onMouseMove={(e) =>
							{
								// Skip the zero-movement move a browser fires when the list scrolls under a still pointer.
								if (index === highlighted || (e.movementX === 0 && e.movementY === 0)) return;
								onHighlight(index);
							}}
							onClick={() =>
							{
								onAccept(item);
							}}
						>
							<span
								className="flex size-[14px] shrink-0 items-center justify-center leading-none"
								style={
								{
									fontSize: 14,
								}}
							>
								{item.char}
							</span>
							<span className="truncate">{`:${item.name}:`}</span>
						</button>
					))}
				</div>
			</div>
		</ViewportPortal>
	);
}
