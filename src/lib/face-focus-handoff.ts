import {type RefObject, useEffect, useLayoutEffect, useRef} from "react";

/*
 * Upstream's send-cell face focus handoff (`LO`, `td`, `zu`, `EH`): when a keyboard-focused Send or Stop face stops
 * being usable, focus moves to the prompt editor instead of falling to the body, and the Enter that activated the
 * face is kept from reaching the editor.
 */

/** Upstream `qo` / `Oq` / `Lt`: keys that never count as keyboard use or end a guard. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Alt", "Control", "Shift", "Meta"]);

/** Upstream `bx`: how long after a handoff an unmodified Enter is swallowed. */
export const ENTER_GUARD_MS = 500;

/** Upstream `Iu`: how long a handoff into a disabled editor waits for the editor to re-enable. */
const HANDOFF_MEMORY_MS = 1000;

/**
 * Upstream `EH`: for {@link ENTER_GUARD_MS} swallow an unmodified Enter at document capture, and any repeating Enter
 * (each repeat extends the guard). The first other non-modifier key, or a window blur that focus doesn't undo in the
 * same microtask, releases it. Returns the release.
 */
export function armEnterGuard(doc: Document): () => void
{
	let deadline = performance.now() + ENTER_GUARD_MS;
	const view = doc.defaultView;
	let blurred = false;
	const onKeyDown = (event: KeyboardEvent) =>
	{
		const unmodified = !(event.shiftKey || event.metaKey || event.ctrlKey || event.altKey);
		if (event.key === "Enter" && (event.repeat || (unmodified && performance.now() < deadline)))
		{
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) deadline = performance.now() + ENTER_GUARD_MS;
		}
		else if (!event.repeat && !MODIFIER_KEYS.has(event.key))
		{
			release();
		}
	};
	const onBlur = () =>
	{
		blurred = true;
		queueMicrotask(() =>
		{
			if (blurred) release();
		});
	};
	const onFocus = () =>
	{
		blurred = false;
	};
	function release(): void
	{
		doc.removeEventListener("keydown", onKeyDown, true);
		view?.removeEventListener("blur", onBlur);
		view?.removeEventListener("focus", onFocus);
	}
	doc.addEventListener("keydown", onKeyDown, true);
	view?.addEventListener("blur", onBlur);
	view?.addEventListener("focus", onFocus);
	return release;
}

interface PendingHandoff
{
	/** The face that handed off; focus still inside it counts as unclaimed. */
	from: HTMLElement;
	forget: () => void;
}

/** Upstream `Lu`: a handoff an editor owes its face, kept for {@link HANDOFF_MEMORY_MS} while it is disabled. */
const pendingHandoffs = new WeakMap<HTMLElement, PendingHandoff>();

/** Upstream `Ru`: a framed page whose frame doesn't hold focus. */
function inUnfocusedFrame(doc: Document): boolean
{
	const view = doc.defaultView;
	return view !== null && view.top !== view.self && !doc.hasFocus();
}

/**
 * Upstream `zu`: where a face hands focus. Null when the window or frame has no focus. Otherwise it remembers the
 * handoff for {@link HANDOFF_MEMORY_MS} (forgotten early on a pointerdown, or on any key but Enter and the modifiers)
 * and returns the editor when it can take focus now; a disabled one picks the handoff up on re-enable.
 */
export function handoffTarget(
	editor: HTMLTextAreaElement | null,
	face: HTMLElement,
	editorDisabled: boolean,
): HTMLElement | null
{
	if (editor === null || !editor.isConnected) return null;
	const owner = editor;
	const doc = editor.ownerDocument;
	if (!doc.hasFocus() || inUnfocusedFrame(doc)) return null;
	pendingHandoffs.get(editor)?.forget();
	const onKeyDown = (event: KeyboardEvent) =>
	{
		if (event.key !== "Enter" && !MODIFIER_KEYS.has(event.key)) forget();
	};
	const timer = setTimeout(forget, HANDOFF_MEMORY_MS);
	function forget(): void
	{
		clearTimeout(timer);
		doc.removeEventListener("pointerdown", forget, true);
		doc.removeEventListener("keydown", onKeyDown, true);
		if (pendingHandoffs.get(owner)?.forget === forget) pendingHandoffs.delete(owner);
	}
	doc.addEventListener("pointerdown", forget, true);
	doc.addEventListener("keydown", onKeyDown, true);
	pendingHandoffs.set(
		editor,
		{
			from: face,
			forget,
		},
	);
	return !editorDisabled && !editor.disabled ? editor : null;
}

/**
 * Upstream's editor zombie guard (`Vu`), run when the editor turns enabled: a remembered handoff lands now if focus
 * is still unclaimed (nothing, the body, the editor, or the face that handed off).
 */
export function pickUpHandoff(editor: HTMLTextAreaElement): void
{
	const pending = pendingHandoffs.get(editor);
	if (pending === undefined) return;
	pending.forget();
	const doc = editor.ownerDocument;
	const active = doc.activeElement;
	if (
		!(active === null || active === doc.body || active === editor || pending.from.contains(active)) ||
		inUnfocusedFrame(doc)
	)
	{
		return;
	}
	editor.focus();
	if (doc.activeElement === editor) armEnterGuard(doc);
}

/**
 * Upstream `LO`: while `usable`, note whether the face wrapper is used from the keyboard (a `:focus-visible` focus or
 * a non-modifier key, undone by a pointerdown). When it stops being usable or unmounts with keyboard focus still
 * inside, focus moves to `pickTarget(wrapper)` and the Enter guard arms. Pointer focus is left alone.
 *
 * Like upstream it runs in a passive effect, after React has put back the focus it saved over the commit. Upstream's
 * leaving face stays mounted; here an idle Send unmounts outright, so a layout cleanup notes whether focus was inside
 * before the button left the document.
 */
export function useFaceFocusHandoff(
	ref: RefObject<HTMLElement | null>,
	usable: boolean,
	pickTarget: (face: HTMLElement) => HTMLElement | null,
): void
{
	const pickRef = useRef(pickTarget);
	pickRef.current = pickTarget;
	const focusedAtUnmountRef = useRef(false);
	useLayoutEffect(() =>
	{
		const face = ref.current;
		return () =>
		{
			focusedAtUnmountRef.current = face?.contains(face.ownerDocument.activeElement) ?? false;
		};
	}, [ref, usable]);
	useEffect(() =>
	{
		const face = usable ? ref.current : null;
		if (face === null) return undefined;
		const doc = face.ownerDocument;
		let keyboard = false;
		let pointerJustPressed = false;
		let pointerTimer: ReturnType<typeof setTimeout> | undefined;
		const onFocusIn = (event: FocusEvent) =>
		{
			try
			{
				keyboard =
					!pointerJustPressed && event.target instanceof Element && event.target.matches(":focus-visible");
			}
			catch
			{
				keyboard = false;
			}
		};
		const onPointerDown = () =>
		{
			keyboard = false;
			pointerJustPressed = true;
			clearTimeout(pointerTimer);
			pointerTimer = setTimeout(() =>
			{
				pointerJustPressed = false;
			}, 0);
		};
		const onKeyDown = (event: KeyboardEvent) =>
		{
			if (!MODIFIER_KEYS.has(event.key)) keyboard = true;
		};
		face.addEventListener("focusin", onFocusIn);
		face.addEventListener("pointerdown", onPointerDown);
		face.addEventListener("keydown", onKeyDown);
		return () =>
		{
			face.removeEventListener("focusin", onFocusIn);
			face.removeEventListener("pointerdown", onPointerDown);
			face.removeEventListener("keydown", onKeyDown);
			clearTimeout(pointerTimer);
			const active = doc.activeElement;
			const inside =
				face.contains(active) ||
				(!face.isConnected && focusedAtUnmountRef.current && (active === null || active === doc.body));
			const target = keyboard && inside ? pickRef.current(face) : null;
			if (target === null) return;
			target.focus(
				{
					preventScroll: true,
				},
			);
			if (doc.activeElement !== target) return;
			const release = armEnterGuard(doc);
			queueMicrotask(() =>
			{
				if (!target.isConnected) release();
			});
		};
	}, [ref, usable]);
}
