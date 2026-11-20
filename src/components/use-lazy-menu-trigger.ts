import
{
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	type SyntheticEvent,
	useRef,
	useState,
} from "react";
import {flushSync} from "react-dom";

/*
 * A sidebar shows dozens of session rows, and each row's kebab menu and right-click menu
 * cost a Base UI root apiece. Rows mount neither until it is first asked for: the asking event
 * mounts the root synchronously and is then replayed on the root's own trigger, so Base UI sees
 * the same press, click, key or right-click it would have seen with an eager root.
 */

/** Dispatches an untrusted copy of `event` on `target`, as `type` when given. */
export function redispatch(target: HTMLElement, event: Event, type = event.type): void
{
	target.dispatchEvent(copyEvent(event, type));
}

function copyEvent(event: Event, type: string): Event
{
	if (event instanceof PointerEvent) return new PointerEvent(type, event);
	if (event instanceof MouseEvent) return new MouseEvent(type, event);
	if (event instanceof KeyboardEvent) return new KeyboardEvent(type, event);
	// Desktop Firefox has no TouchEvent.
	if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent)
	{
		return new TouchEvent(
			type,
			{
				...eventInit(event),
				touches: [...event.touches],
				targetTouches: [...event.targetTouches],
				changedTouches: [...event.changedTouches],
				altKey: event.altKey,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				shiftKey: event.shiftKey,
			},
		);
	}
	return new Event(type, event);
}

function eventInit(event: Event): EventInit
{
	return {
		bubbles: event.bubbles,
		cancelable: event.cancelable,
		composed: event.composed,
	};
}

/** Arrow keys open a closed menu from its trigger (Base UI's `openOnArrowKeyDown`). */
const OPENING_KEYS: ReadonlySet<string> = new Set(["ArrowDown", "ArrowUp"]);

/**
 * A press began on the placeholder, which is gone by the time the browser's own mousedown
 * follows; if that mousedown lands on the real trigger anyway, it must not toggle the menu the
 * replay just opened.
 */
function swallowTrustedMouseDown(trigger: HTMLElement): void
{
	const swallow = (event: MouseEvent) =>
	{
		if (event.isTrusted) event.stopPropagation();
	};
	trigger.addEventListener("mousedown", swallow, true);
	setTimeout(() =>
	{
		trigger.removeEventListener("mousedown", swallow, true);
	}, 0);
}

export interface LazyMenuTrigger<T extends HTMLElement>
{
	/** Whether the real menu root (and its trigger) has mounted. */
	mounted: boolean;
	/** For the real trigger, so a replay can reach it. */
	triggerRef: RefObject<T | null>;
	/** Handlers for the placeholder that stands in for the trigger until then. */
	placeholderProps:
	{
		onPointerDown: (event: ReactPointerEvent<T>) => void;
		onMouseDown: (event: ReactMouseEvent<T>) => void;
		onClick: (event: ReactMouseEvent<T>) => void;
		onKeyDown: (event: ReactKeyboardEvent<T>) => void;
	};
}

/** A button menu whose root mounts on the trigger's first press, click or opening key. */
export function useLazyMenuTrigger<T extends HTMLElement>(): LazyMenuTrigger<T>
{
	const [mounted, setMounted] = useState(false);
	const triggerRef = useRef<T>(null);
	const activate = (event: SyntheticEvent<T>, replay: readonly (readonly [Event, string])[]): HTMLElement | null =>
	{
		event.stopPropagation();
		const hadFocus = event.currentTarget.ownerDocument.activeElement === event.currentTarget;
		flushSync(() =>
		{
			setMounted(true);
		});
		const trigger = triggerRef.current;
		if (trigger === null) return null;
		if (hadFocus)
			trigger.focus(
				{
					preventScroll: true,
				},
			);
		for (const [replayed, type] of replay) redispatch(trigger, replayed, type);
		return trigger;
	};
	return {
		mounted,
		triggerRef,
		placeholderProps:
		{
			onPointerDown: (event) =>
			{
				if (event.button !== 0) return;
				const native = event.nativeEvent;
				// A touch's mousedown and click follow on lift, at the real trigger; a mouse's follow now.
				if (event.pointerType === "touch")
				{
					activate(event, [[native, native.type]]);
					return;
				}
				const trigger = activate(event, [
					[native, native.type],
					[native, "mousedown"],
				]);
				if (trigger !== null) swallowTrustedMouseDown(trigger);
			},
			onMouseDown: (event) =>
			{
				if (event.button !== 0) return;
				activate(event, [[event.nativeEvent, event.nativeEvent.type]]);
			},
			onClick: (event) =>
			{
				activate(event, [[event.nativeEvent, event.nativeEvent.type]]);
			},
			onKeyDown: (event) =>
			{
				if (!OPENING_KEYS.has(event.key)) return;
				activate(event, [[event.nativeEvent, event.nativeEvent.type]]);
			},
		},
	};
}
