import {type RefCallback, useCallback, useState} from "react";

import {useIsOverflowing} from "./use-is-overflowing";

export interface LabelUnclipInput
{
	/** The row is bodiless and settled, so its label and meta are measured for clipping. */
	measured: boolean;
	labelClipped: boolean;
	metaClipped: boolean;
	/** The row already discloses a body, so it expands whether or not its text clips. */
	hasDisclosure: boolean;
	wantsOpen: boolean;
}

export interface LabelUnclipState
{
	/** The row expands only to show its own clipped text. */
	selfExpands: boolean;
	expandable: boolean;
	open: boolean;
	/** The row is open with its label and meta wrapped in full. */
	rowUnclipped: boolean;
}

/** Upstream `$W` (shared-9): a bodiless row whose label or meta clips becomes expandable, and opening it unclips them. */
export function labelUnclipState({
	measured,
	labelClipped,
	metaClipped,
	hasDisclosure,
	wantsOpen,
}: LabelUnclipInput): LabelUnclipState
{
	const selfExpands = measured && (labelClipped || metaClipped);
	const expandable = hasDisclosure || selfExpands;
	const open = wantsOpen && expandable;
	return {
		selfExpands,
		expandable,
		open,
		rowUnclipped: selfExpands && open,
	};
}

export interface LabelUnclip extends LabelUnclipState
{
	labelRef: RefCallback<HTMLElement>;
	metaRef: RefCallback<HTMLElement>;
	toggle: () => void;
	close: () => void;
}

/**
 * Measures a bodiless row's label and meta (`text` re-measures on change) and owns the row's open state.
 */
export function useLabelUnclip({measured, text}: {measured: boolean; text: string}): LabelUnclip
{
	const [labelElement, setLabelElement] = useState<HTMLElement | null>(null);
	const [metaElement, setMetaElement] = useState<HTMLElement | null>(null);
	const [wantsOpen, setWantsOpen] = useState(false);
	// Frozen while open, so unclipping the text, which then fits, never closes the row it just opened.
	const labelClipped = useIsOverflowing(measured ? labelElement : null, text, 0, wantsOpen);
	const metaClipped = useIsOverflowing(measured ? metaElement : null, text, 0, wantsOpen);
	const labelRef = useCallback((node: HTMLElement | null) =>
	{
		setLabelElement(node);
	}, []);
	const metaRef = useCallback((node: HTMLElement | null) =>
	{
		setMetaElement(node);
	}, []);
	const toggle = useCallback(() =>
	{
		setWantsOpen((open) => !open);
	}, []);
	const close = useCallback(() =>
	{
		setWantsOpen(false);
	}, []);
	return {
		...labelUnclipState(
			{
				measured,
				labelClipped,
				metaClipped,
				hasDisclosure: false,
				wantsOpen,
			},
		),
		labelRef,
		metaRef,
		toggle,
		close,
	};
}
