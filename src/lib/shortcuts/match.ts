import {type Binding, getShortcut, type ShortcutId, type ShortcutModifier} from "./registry";

type ShortcutKeyEvent = Pick<
	KeyboardEvent,
	"key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "getModifierState"
>;

const MODIFIER_FLAGS = {
	cmd: "metaKey",
	ctrl: "ctrlKey",
	alt: "altKey",
	shift: "shiftKey",
} as const satisfies Record<ShortcutModifier, keyof ShortcutKeyEvent>;

const MODIFIERS = Object.keys(MODIFIER_FLAGS) as ShortcutModifier[];

export function isMacPlatform(): boolean {
	return typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isWindowsPlatform(): boolean {
	return typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent);
}

/** Code-first key match with strict modifier equality and an AltGraph guard. */
export function matchBinding(event: ShortcutKeyEvent, binding: Binding): boolean {
	const keyMatches =
		binding.code === undefined ? event.key.toLowerCase() === binding.key : event.code === binding.code;
	if (!keyMatches) return false;
	for (const modifier of MODIFIERS) {
		if (event[MODIFIER_FLAGS[modifier]] !== binding.modifiers.includes(modifier)) return false;
	}
	if (binding.modifiers.includes("ctrl") && binding.modifiers.includes("alt") && event.getModifierState("AltGraph")) {
		return false;
	}
	return true;
}

const NON_TEXT_INPUT_TYPES = new Set([
	"button",
	"submit",
	"reset",
	"checkbox",
	"radio",
	"file",
	"image",
	"color",
	"range",
]);

export function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
	if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
	return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

const MODAL_LAYER_SELECTOR = [
	'[role="menu"]',
	'[role="listbox"]',
	'[role="dialog"]',
	'[role="alertdialog"]',
	'[aria-modal="true"]',
	"[data-radix-popper-content-wrapper]",
	"[cmdk-root]",
].join(",");

/** Focus is inside a menu, listbox, dialog or popper, where app shortcuts yield. */
export function isInModalLayer(element: Element | null): boolean {
	const layer = element?.closest(MODAL_LAYER_SELECTOR) ?? null;
	return layer !== null && layer.getAttribute("aria-modal") !== "false";
}

export function bindingsFor(id: ShortcutId, isMac: boolean, isWindows = false): Binding[] {
	const platforms = isMac ? ["mac"] : ["non-mac", isWindows ? "windows" : "linux"];
	return getShortcut(id).bindings.filter((b) => b.platform === undefined || platforms.includes(b.platform));
}
