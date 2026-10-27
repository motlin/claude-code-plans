import {useLayoutEffect, useRef, type FocusEvent} from "react";

type FocusedToggle = {element: HTMLElement; slot: number | "rail"};

function focusVisible(element: HTMLElement): boolean {
	try {
		return element.matches(":focus-visible");
	} catch {
		return false;
	}
}

/**
 * Upstream's `eW` focus-on-fold: when the titlebar's measured fold unmounts a
 * keyboard-focused trail toggle, focus moves to the inline toggle now at the
 * same index, or the last one; a folded rail toggle (or no toggle left) hands
 * focus to the View options trigger.
 */
export function useFoldFocus() {
	const togglesRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const focused = useRef<FocusedToggle | null>(null);

	useLayoutEffect(() => {
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
		target?.focus({focusVisible: true});
	});

	const onBlur = (event: FocusEvent<HTMLElement>) => {
		if (focused.current?.element === event.target) focused.current = null;
	};

	return {
		togglesRef,
		triggerRef,
		railFocusProps: {
			onFocus: (event: FocusEvent<HTMLElement>) => {
				focused.current = focusVisible(event.target) ? {element: event.target, slot: "rail"} : null;
			},
			onBlur,
		},
		togglesFocusProps: {
			onFocus: (event: FocusEvent<HTMLElement>) => {
				const buttons = [...(togglesRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
				const slot = buttons.indexOf(event.target);
				focused.current = slot >= 0 && focusVisible(event.target) ? {element: event.target, slot} : null;
			},
			onBlur,
		},
	};
}
