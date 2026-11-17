import {useLayoutEffect, useRef, useState, type FocusEvent, type RefObject} from "react";

type FocusedToggle =
{
	element: HTMLElement;
	slot: number | "rail";
};

function focusVisible(element: HTMLElement): boolean
{
	try
	{
		return element.matches(":focus-visible");
	}
	catch
	{
		return false;
	}
}

/**
 * Upstream's `eW` focus-on-fold: when the titlebar's measured fold unmounts a
 * keyboard-focused trail toggle, focus moves to the inline toggle now at the
 * same index, or the last one; a folded rail toggle (or no toggle left) hands
 * focus to the View options trigger.
 */
export function useFoldFocus()
{
	const togglesRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const focused = useRef<FocusedToggle | null>(null);

	useLayoutEffect(() =>
	{
		const last = focused.current;
		if (last === null || last.element.isConnected) return;
		focused.current = null;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		const buttons = [...(togglesRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
		const target =
			last.slot === "rail"
				? triggerRef.current
				: (buttons[Math.min(last.slot, buttons.length - 1)] ?? triggerRef.current);
		target?.focus(
			{
				focusVisible: true,
			},
		);
	});

	const onBlur = (event: FocusEvent<HTMLElement>) =>
	{
		if (focused.current?.element === event.target) focused.current = null;
	};

	return {
		togglesRef,
		triggerRef,
		railFocusProps:
		{
			onFocus: (event: FocusEvent<HTMLElement>) =>
			{
				focused.current = focusVisible(event.target)
					?
						{
							element: event.target,
							slot: "rail",
						}
					: null;
			},
			onBlur,
		},
		togglesFocusProps:
		{
			onFocus: (event: FocusEvent<HTMLElement>) =>
			{
				const buttons = [...(togglesRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
				const slot = buttons.indexOf(event.target);
				focused.current =
					slot >= 0 && focusVisible(event.target)
						?
							{
								element: event.target,
								slot,
							}
						: null;
			},
			onBlur,
		},
	};
}

/**
 * Upstream's `eX` emptied-focus handoff: while the View options trigger shows,
 * remember its document when the menu is open or the trigger has focus; when
 * the trigger disappears and focus fell to the body, a microtask later focus
 * moves to the last inline pane toggle. Spread the returned props on the
 * trigger so its focus re-runs the effect.
 */
export function useEmptiedFocus({
	shown,
	open,
	triggerRef,
	togglesRef,
}: {
	shown: boolean;
	open: boolean;
	triggerRef: RefObject<HTMLButtonElement | null>;
	togglesRef: RefObject<HTMLDivElement | null>;
})
{
	const lastDocument = useRef<Document | null>(null);
	const [focused, setFocused] = useState(false);

	useLayoutEffect(() =>
	{
		if (shown)
		{
			const trigger = triggerRef.current;
			lastDocument.current = trigger !== null && (open || focused) ? trigger.ownerDocument : null;
			return;
		}
		const doc = lastDocument.current;
		lastDocument.current = null;
		if (doc === null) return;
		queueMicrotask(() =>
		{
			const active = doc.activeElement;
			if (active !== null && active !== doc.body) return;
			const buttons = togglesRef.current?.querySelectorAll<HTMLElement>("button");
			buttons?.[buttons.length - 1]?.focus(
				{
					preventScroll: true,
				},
			);
		});
	}, [shown, open, focused, triggerRef, togglesRef]);

	return {
		onFocus: () =>
		{
			setFocused(true);
		},
		onBlur: () =>
		{
			setFocused(false);
		},
	};
}
