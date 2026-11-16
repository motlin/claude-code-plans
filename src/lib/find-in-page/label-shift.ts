/**
 * Upstream's truncating-label shift (shared-100 `yS`/`uC`/`mQ`/`r6`/`mB`): when the active find match
 * sits under a clipped label's end fade or past its clip, the label's text slides back so the match
 * starts 28px in, and the text that slid off fades in over 24px.
 */

/** Upstream `j_`: where the shifted match starts, from the box's inline-start edge. */
const LABEL_SHIFT_LEAD_PX = 28;
/** Upstream `rb`: the fade over the text that slid off. */
export const LABEL_SHIFT_FADE_PX = 24;

export interface TruncatingLabel
{
	/** The clipping outer element. */
	readonly box: HTMLElement;
	/** The inner element that moves. */
	readonly text: HTMLElement;
	/** How many px at the box's end are hidden (fade or decoration); 0 when the label fits. */
	readonly endBandPx: () => number;
}

const labels = new Map<Node, TruncatingLabel>();

interface Shift
{
	readonly text: HTMLElement;
	readonly by: number;
	readonly range: Range;
}

let current: Shift | null = null;

/** Upstream `yS`: register a label; returns its unregister. */
export function registerTruncatingLabel(label: TruncatingLabel): () => void
{
	labels.set(label.text, label);
	return () =>
	{
		if (labels.get(label.text) === label) labels.delete(label.text);
	};
}

/** Upstream `uC`: the registered label whose text holds `node`. */
export function findTruncatingLabel(node: Node | null | undefined): TruncatingLabel | undefined
{
	for (let at = node; at; at = at.parentNode)
	{
		const label = labels.get(at);
		if (label !== undefined) return label;
	}
	return undefined;
}

/** Upstream `mQ`: the clipping box of the label holding `node`. */
export function truncatingLabelBox(node: Node | null | undefined): HTMLElement | undefined
{
	return findTruncatingLabel(node)?.box;
}

function resetStyles(text: HTMLElement): void
{
	text.style.transform = "";
	text.style.maskImage = "";
}

/** Upstream `r6`: shift the label holding the active match so it shows, or reset when there is none. */
export function shiftLabelForActiveMatch(range: Range | null): void
{
	const label = range === null ? undefined : findTruncatingLabel(range.startContainer);
	let by = 0;
	let rtl = false;
	if (range !== null && label !== undefined)
	{
		const style = getComputedStyle(label.box);
		rtl = style.direction === "rtl";
		const pad = Number.parseFloat(style.paddingInlineStart) || 0;
		const box = label.box.getBoundingClientRect();
		const rect = range.getBoundingClientRect();
		const applied = current?.text === label.text ? current.by : 0;
		const offset = (rtl ? box.right - rect.right : rect.left - box.left) - pad + applied;
		const band = label.endBandPx();
		if (band > 0 && rect.width > 0 && offset + rect.width > box.width - pad - band)
			by = Math.max(0, Math.round(offset - LABEL_SHIFT_LEAD_PX));
	}
	const previous = current;
	current =
		range !== null && label !== undefined
			?
				{
					text: label.text,
					by,
					range,
				}
			: null;
	if (previous !== null && previous.by > 0 && (previous.text !== current?.text || current.by === 0))
		resetStyles(previous.text);
	if (current !== null && current.by > 0 && (previous?.text !== current.text || previous.by !== current.by))
	{
		current.text.style.transform = `translateX(${rtl ? by : -by}px)`;
		current.text.style.maskImage = `linear-gradient(to ${rtl ? "left" : "right"}, transparent ${by}px, black ${by + LABEL_SHIFT_FADE_PX}px)`;
	}
}

/** Upstream `mB`: re-measure the shift after the label holding the active match resized. */
export function recomputeLabelShift(text: HTMLElement): void
{
	if (current?.text === text) shiftLabelForActiveMatch(current.range);
}
