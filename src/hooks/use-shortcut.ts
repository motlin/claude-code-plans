import {useEffect, useRef} from "react";

import {bindingsFor, isEditableTarget, isInModalLayer, isMacPlatform, matchBinding} from "../lib/shortcuts/match";
import {toAriaKeyShortcuts} from "../lib/shortcuts/format";
import {type Binding, bindingToKeys, type ShortcutId} from "../lib/shortcuts/registry";
import {useIsMac} from "./use-is-mac";

/** Return `false` to decline the event and let the next handler claim it. */
export type ShortcutHandler = (event: KeyboardEvent, binding: Binding) => boolean | void;

export interface ShortcutOptions {
	disabled?: boolean;
	/** Fire while focus is in an input, textarea or contenteditable. Default true, like upstream. */
	allowInEditable?: boolean;
	/** Fire while focus is inside a menu, listbox, dialog or popper. Default false. */
	allowInModal?: boolean;
	/** Higher priority claims first; ties go to the most recently registered. */
	priority?: number;
}

interface Registration {
	id: ShortcutId;
	handler: {current: ShortcutHandler};
	options: {current: ShortcutOptions};
	seq: number;
}

const registrations: Registration[] = [];
let nextSeq = 0;

function byPriority(a: Registration, b: Registration): number {
	const priorityDelta = (b.options.current.priority ?? 0) - (a.options.current.priority ?? 0);
	return priorityDelta === 0 ? b.seq - a.seq : priorityDelta;
}

/**
 * Run an event through the app shortcut handlers directly. For widgets such
 * as the terminal that swallow keys (and call preventDefault) before the
 * document listener would see them.
 */
export function dispatchShortcutEvent(event: KeyboardEvent): void {
	dispatch(event);
}

function dispatch(event: KeyboardEvent): void {
	if (event.defaultPrevented) return;
	const isMac = isMacPlatform();
	const inModal = isInModalLayer(document.activeElement);
	const inEditable = isEditableTarget(event.target);
	for (const registration of [...registrations].sort(byPriority)) {
		const {disabled = false, allowInEditable = true, allowInModal = false} = registration.options.current;
		if (disabled) continue;
		const binding = bindingsFor(registration.id, isMac).find((b) => matchBinding(event, b));
		if (binding === undefined) continue;
		if (inModal && !allowInModal) continue;
		if (inEditable && !allowInEditable) continue;
		if (event.repeat) {
			event.preventDefault();
			return;
		}
		if (registration.handler.current(event, binding) === false) continue;
		event.preventDefault();
		return;
	}
}

function register(registration: Registration): () => void {
	if (registrations.length === 0) document.addEventListener("keydown", dispatch);
	registrations.push(registration);
	return () => {
		const index = registrations.indexOf(registration);
		if (index !== -1) registrations.splice(index, 1);
		if (registrations.length === 0) document.removeEventListener("keydown", dispatch);
	};
}

/** Bind a registry shortcut through the single document keydown dispatcher. */
export function useShortcut(id: ShortcutId, handler: ShortcutHandler, options: ShortcutOptions = {}): void {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;
	const optionsRef = useRef(options);
	optionsRef.current = options;

	useEffect(() => register({id, handler: handlerRef, options: optionsRef, seq: nextSeq++}), [id]);
}

export interface ShortcutKeys {
	/** First binding for this platform as a "shift+cmd+k" keys string, for `<Shortcut keys>`. */
	keys: string;
	ariaKeyShortcuts: string;
}

/** Display keys for a registry shortcut's first binding on the current platform. */
export function useShortcutKeys(id: ShortcutId): ShortcutKeys {
	const isMac = useIsMac();
	const binding = bindingsFor(id, isMac)[0];
	if (binding === undefined) throw new Error(`Shortcut ${id} has no binding for this platform`);
	const keys = bindingToKeys(binding);
	return {keys, ariaKeyShortcuts: toAriaKeyShortcuts(keys, isMac)};
}
