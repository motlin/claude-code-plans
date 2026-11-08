import {type RefObject, useEffect, useLayoutEffect, useRef} from "react";

import {readoutLabelParts} from "../../lib/stacked-meter-layout";

/* Upstream's lazy lg StackedMeter readout card (c6b47b88e ReadoutCard on the cddbfc1b6 positioner, frame and rows). */

export interface StackedMeterReadoutRow {
	id: string;
	label: string;
	paint: string;
	amount: string;
	share: string;
}

/** The card's gap from the meter and its inset from the viewport edges. */
const OFFSET_PX = 8;

/**
 * Where the card goes: centred on `x` along the meter, below it (above for touch, so the finger doesn't cover it),
 * flipped when that side doesn't fit and kept inside the viewport.
 */
function placeCard(
	bar: DOMRect,
	card: {width: number; height: number},
	x: number,
	above: boolean,
	viewport: {width: number; height: number},
): {left: number; top: number} {
	const maxLeft = viewport.width - card.width - OFFSET_PX;
	const left = Math.max(OFFSET_PX, Math.min(bar.left + x - card.width / 2, maxLeft));
	const before = bar.top - card.height - OFFSET_PX;
	const after = bar.bottom + OFFSET_PX;
	const fitsBefore = before >= OFFSET_PX;
	const fitsAfter = after + card.height <= viewport.height - OFFSET_PX;
	const top = above ? (fitsBefore || !fitsAfter ? before : after) : fitsAfter || !fitsBefore ? after : before;
	return {left, top};
}

/** Upstream's readout label `G`: truncates, keeping a long label's last 8 graphemes visible. */
function ReadoutLabel({label, emphasized}: {label: string; emphasized: boolean}) {
	const {head, tail} = readoutLabelParts(label);
	const base = `max-w-[240px] justify-self-start text-footnote ${emphasized ? "text-primary" : "text-secondary"}`;
	const mark = emphasized ? {"data-emphasized": true} : {};
	if (tail === "") {
		return (
			<span dir="auto" {...mark} className={`truncate ${base}`}>
				{label}
			</span>
		);
	}
	return (
		<span dir="auto" {...mark} className={`flex ${base}`}>
			<span className="truncate">{head}</span>
			<span className="shrink-0">{tail}</span>
		</span>
	);
}

export function StackedMeterReadoutCard({
	barRef,
	width,
	thickness,
	x,
	heading,
	rows,
	pointedId,
	above,
	onDismiss,
	onDisplaced,
}: {
	barRef: RefObject<HTMLDivElement | null>;
	width: number;
	thickness: number;
	x: number;
	heading: string | undefined;
	rows: readonly StackedMeterReadoutRow[];
	pointedId: string | null;
	above: boolean;
	onDismiss: () => void;
	onDisplaced: () => void;
}) {
	const card = useRef<HTMLDivElement>(null);
	const shown = useRef(false);

	useEffect(() => {
		const doc = barRef.current?.ownerDocument;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.isComposing) return;
			event.preventDefault();
			event.stopPropagation();
			onDismiss();
		};
		doc?.addEventListener("keydown", onKeyDown, true);
		return () => {
			doc?.removeEventListener("keydown", onKeyDown, true);
		};
	}, [barRef, onDismiss]);

	useLayoutEffect(() => {
		const element = card.current;
		const bar = barRef.current;
		if (element === null || bar === null) return undefined;
		const place = (jump: boolean) => {
			if (!shown.current) {
				try {
					element.showPopover();
					element.style.position = "fixed";
				} catch {
					// No popover support: the absolute card still draws in the meter.
				}
			}
			const root = element.ownerDocument.documentElement;
			const barBox = bar.getBoundingClientRect();
			// A meter scrolled out of the viewport takes its card with it (upstream's onDisplaced).
			if (barBox.height > 0 && (barBox.bottom < 0 || barBox.top > root.clientHeight)) {
				onDisplaced();
				return;
			}
			const {left, top} = placeCard(
				barBox,
				{width: element.offsetWidth, height: element.offsetHeight},
				x,
				above,
				{width: root.clientWidth, height: root.clientHeight},
			);
			// Upstream springs the card (stiffness 950, damping 55, mass 0.85) and jumps it on first show.
			element.style.transition =
				jump || !shown.current ? "none" : "transform 150ms cubic-bezier(0.2, 0.9, 0.3, 1)";
			element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
			shown.current = true;
		};
		place(false);
		const view = element.ownerDocument.defaultView ?? window;
		const jump = () => {
			place(true);
		};
		view.addEventListener("scroll", jump, {capture: true, passive: true});
		view.addEventListener("resize", jump);
		return () => {
			view.removeEventListener("scroll", jump, {capture: true});
			view.removeEventListener("resize", jump);
		};
	}, [barRef, x, above, width, thickness, rows, onDisplaced]);

	return (
		<div
			ref={card}
			popover="manual"
			aria-hidden="true"
			className="pointer-events-none absolute left-0 top-0 z-10 m-0 block w-max overflow-visible rounded border bg-surface-popover px-sm py-xs font-normal shadow-popover [inset:0_auto_auto_0]"
		>
			{heading !== undefined && (
				<div className="text-caption text-secondary">
					<bdi>{heading}</bdi>
				</div>
			)}
			<div className="grid grid-cols-[auto_auto_auto_1fr] items-center gap-x-xs gap-y-xs pt-xs">
				{rows.map((row) => (
					<ReadoutRow key={row.id} row={row} emphasized={row.id === pointedId} />
				))}
			</div>
		</div>
	);
}

/** Upstream's row `Z`: swatch, amount, share and label cells in the card's 4-column grid. */
function ReadoutRow({row, emphasized}: {row: StackedMeterReadoutRow; emphasized: boolean}) {
	return (
		<>
			<span
				aria-hidden
				className="shrink-0 forced-color-adjust-none"
				style={{
					width: 10,
					height: 10,
					borderRadius: 2,
					background: row.paint,
					display: "inline-block",
				}}
			/>
			<span className="text-footnote font-medium tabular-nums text-primary">{row.amount}</span>
			<span className="text-footnote tabular-nums text-secondary">{row.share}</span>
			<ReadoutLabel label={row.label} emphasized={emphasized} />
		</>
	);
}
