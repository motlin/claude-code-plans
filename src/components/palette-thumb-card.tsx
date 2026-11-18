import
{
	type CSSProperties,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
} from "react";
import {createPortal} from "react-dom";

import {isThumbLoaded, type PaletteThumb, thumbKey} from "../lib/palette-thumb-store";
import {FORCED_COLORS_BORDER_CLASS} from "./ui/popover-surface";
import {THUMB_CARD_WIDTH, THUMB_DEFAULT_HEIGHT} from "./palette-thumb-geometry";
import {PaletteThumbImage} from "./palette-thumb-image";
import {findRow, measureThumbCard, slideThumb, type ThumbPlacement} from "./palette-thumb-measure";
import {Skeleton} from "./ui/skeleton";

interface Swap
{
	rowKey: string;
	picture: string;
	/** The card showed something when the row changed, so it slides to the new row. */
	slides: boolean;
	/** The old picture stays up for one snap while the new one loads. */
	holds: boolean;
}

/** Upstream's `Lt`/`Rt`: hold the old picture for one snap, or hide it at once. */
const HOLD_STYLE: CSSProperties =
{
	transition: "visibility 0s linear var(--cds-dur-snap, 120ms)",
};
const HIDE_STYLE: CSSProperties =
{
	transition: "none",
};

/** The card's height, or upstream's 204 before its first layout. */
function measuredHeight(card: HTMLElement | null): number
{
	const height = card?.offsetHeight ?? 0;
	return height > 0 ? height : THUMB_DEFAULT_HEIGHT;
}

function sameSpot(a: ThumbPlacement | null, b: ThumbPlacement | null): boolean
{
	return (
		a === b ||
		(a !== null &&
			b !== null &&
			a.rowKey === b.rowKey &&
			a.top === b.top &&
			a.left === b.left &&
			(a.fromCard === null) === (b.fromCard === null))
	);
}

function bump(count: number): number
{
	return count + 1;
}

function dropHold(swap: Swap): Swap
{
	return swap.holds
		?
			{
				...swap,
				holds: false,
			}
		: swap;
}

function preventMouseDown(event: {preventDefault: () => void}): void
{
	event.preventDefault();
}

/**
 * Upstream's ⌘K artifact thumb card `Bt`: a 280px screenshot of the selected artifact row with "kind · when" under
 * it, portalled beside the palette at the row's height. It stays invisible until its picture loads (a skeleton shows
 * after the reveal delay), slides between rows, forwards the wheel to the results list and never takes focus.
 * Remounted after the row-actions card closes, it slides back from that card's spot.
 */
export function PaletteThumbCard({
	thumb,
	meta,
	listRef,
	rowKey,
	slot,
	initialReturning,
	onShownChange,
}: {
	thumb: PaletteThumb;
	/** Upstream's `It`: "kind · when". */
	meta: string;
	listRef: RefObject<HTMLElement | null>;
	/** The selected row's cmdk value. */
	rowKey: string;
	slot: HTMLElement;
	initialReturning: boolean;
	onShownChange: (shown: boolean) => void;
})
{
	const picture = thumbKey(thumb.src);
	// The picture the card last showed, so a row change can hold it while the next one loads.
	const [shownPicture, setShownPicture] = useState<string | null>(() => (isThumbLoaded(thumb) ? picture : null));
	const loaded = shownPicture === picture;
	const [returningAtMount, setReturningAtMount] = useState(initialReturning);
	const hasPicture = shownPicture !== null || returningAtMount;
	const [placed, setPlaced] = useState<ThumbPlacement | null>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const pictureRef = useRef<HTMLDivElement>(null);
	const [returning, setReturning] = useState(initialReturning);
	const [swap, setSwap] = useState<Swap>(
		{
			rowKey,
			picture,
			slides: false,
			holds: false,
		},
	);
	if (swap.rowKey !== rowKey)
	{
		setSwap(
			{
				rowKey,
				picture,
				slides: hasPicture,
				holds: shownPicture !== null && shownPicture === swap.picture,
			},
		);
		setReturning(false);
	}
	const [measureTick, remeasure] = useReducer(bump, 0);
	const placedKnown = placed !== null;

	// A cached picture is complete before React sees its load event.
	useLayoutEffect(() =>
	{
		const img = pictureRef.current?.querySelector("img");
		if (img?.complete === true && img.naturalWidth > 0 && (img.currentSrc === "" || img.currentSrc === img.src))
			setShownPicture(picture);
	}, [picture, placedKnown]);

	useLayoutEffect(() =>
	{
		const list = listRef.current;
		const next =
			list === null
				? null
				: measureThumbCard(
						{
							list,
							rowKey,
							cardHeight: measuredHeight(cardRef.current),
							returning,
						},
					);
		if (next === null)
		{
			setReturning(false);
			setShownPicture(null);
			setReturningAtMount(false);
		}
		setPlaced((current) => (sameSpot(current, next) ? current : next));
	}, [listRef, rowKey, thumb, returning, measureTick]);

	useEffect(() =>
	{
		const list = listRef.current;
		const dialog = list?.closest<HTMLElement>('[role="dialog"]') ?? null;
		const onDialogEnd = (event: Event) =>
		{
			if (event.target === dialog) remeasure();
		};
		list?.addEventListener(
			"scroll",
			remeasure,
			{
				passive: true,
			},
		);
		window.addEventListener("resize", remeasure);
		dialog?.addEventListener("transitionend", onDialogEnd);
		dialog?.addEventListener("animationend", onDialogEnd);
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() =>
					{
						remeasure();
					});
		const row = list === null ? null : findRow(list, rowKey);
		for (const el of [dialog, list, ...(list?.children ?? []), row, cardRef.current])
			if (el !== null) observer?.observe(el);
		return () =>
		{
			list?.removeEventListener("scroll", remeasure);
			window.removeEventListener("resize", remeasure);
			dialog?.removeEventListener("transitionend", onDialogEnd);
			dialog?.removeEventListener("animationend", onDialogEnd);
			observer?.disconnect();
		};
	}, [listRef, rowKey, placedKnown]);

	// Upstream slides to the new row when the card showed a picture, else drops the hold.
	const previousRef = useRef<ThumbPlacement | null>(null);
	const {slides} = swap;
	useLayoutEffect(() =>
	{
		const previous = previousRef.current;
		previousRef.current = placed;
		if (previous === null || placed === null || previous.rowKey === placed.rowKey) return;
		if (!(slides && cardRef.current !== null && slideThumb(cardRef.current, previous.top, placed.top)))
			setSwap(dropHold);
	}, [placed, slides]);

	const shown = hasPicture && placed !== null;
	useEffect(() =>
	{
		onShownChange(shown);
	}, [shown, onShownChange]);
	useEffect(
		() => () =>
		{
			onShownChange(false);
		},
		[onShownChange],
	);

	const onLoaded = useCallback(() =>
	{
		setShownPicture(picture);
	}, [picture]);

	if (placed === null) return null;

	const fromCard = returning ? placed.fromCard : null;
	const className = [
		"pointer-events-auto absolute p-1.5 bg-[var(--menu-bg)] shadow-[var(--menu-shadow)] rounded-card",
		FORCED_COLORS_BORDER_CLASS,
		...(hasPicture ? [] : ["invisible"]),
		...(shown && returning && placed.fromCard !== null
			? ["animate-palette-thumb-return motion-reduce:animate-none"]
			: []),
	].join(" ");
	const style: CSSProperties & Record<`--${string}`, string> =
	{
		width: THUMB_CARD_WIDTH,
		top: placed.top,
		left: placed.left,
		...(fromCard === null
			? {}
			:
				{
					"--cp-thumb-from-x": `${-fromCard.x}px`,
					"--cp-thumb-from-y": `${-fromCard.y}px`,
				}),
	};

	return createPortal(
		<div
			ref={cardRef}
			aria-hidden="true"
			data-testid="palette-thumb-card"
			className={className}
			style={style}
			onMouseDown={preventMouseDown}
			onWheel={(event) =>
			{
				listRef.current?.scrollBy(
					{
						top: event.deltaY,
						left: event.deltaX,
					},
				);
			}}
			onAnimationEnd={(event) =>
			{
				if (event.target === event.currentTarget) setReturning(false);
			}}
		>
			<div className="relative">
				<div
					ref={pictureRef}
					className={loaded ? "" : "invisible"}
					style={loaded ? undefined : swap.holds ? HOLD_STYLE : HIDE_STYLE}
				>
					<PaletteThumbImage thumb={thumb} onLoaded={onLoaded} />
				</div>
				{hasPicture && !loaded && (
					<Skeleton key={picture} silent className="absolute inset-0 h-full animate-placeholder-reveal" />
				)}
			</div>
			<div className="truncate px-1 pt-1.5 pb-0.5 text-caption text-muted-as-secondary">{meta}</div>
		</div>,
		slot,
	);
}
