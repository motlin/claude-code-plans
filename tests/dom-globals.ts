// DOM objects whose every own property a fresh jsdom page starts with: a file that overrides, deletes or adds one by hand
// (an offsetParent getter, a missing animate or scrollIntoView, a navigator.clipboard) is put back after it.
function domOwners(): object[]
{
	return [
		document,
		navigator,
		EventTarget.prototype,
		Node.prototype,
		CharacterData.prototype,
		Text.prototype,
		Element.prototype,
		HTMLElement.prototype,
		SVGElement.prototype,
		HTMLCanvasElement.prototype,
		HTMLImageElement.prototype,
		HTMLInputElement.prototype,
		HTMLTextAreaElement.prototype,
		Document.prototype,
		Range.prototype,
		Selection.prototype,
		Navigator.prototype,
	];
}

// Globals files replace by assignment rather than vi.stubGlobal. Only these: vitest and the test files keep their own
// state on globalThis too, and that must survive. localStorage, sessionStorage and fetch belong to worker-globals.ts.
const GLOBAL_NAMES = [
	"ResizeObserver",
	"IntersectionObserver",
	"MutationObserver",
	"matchMedia",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"scrollTo",
	"innerWidth",
	"innerHeight",
	"visualViewport",
	"open",
	"EventSource",
	"WebSocket",
	"ClipboardItem",
	"Image",
	"SpeechSynthesisUtterance",
] as const;

interface OwnerSnapshot
{
	owner: object;
	descriptors: Map<PropertyKey, PropertyDescriptor>;
	/**
	 * What each accessor read when captured. jsdom's window globals are accessors, so assigning one (as fake timers'
	 * uninstall does with the requestAnimationFrame a stub replaced) changes what it reads but not its descriptor.
	 */
	accessorValues: Map<PropertyKey, unknown>;
	/** Restore only these keys, or every own key when absent. */
	keys?: readonly PropertyKey[];
}

declare global
{
	/** The worker's DOM as the first file found it, kept on globalThis so a shared worker's rerun of the setup file finds it. */
	var ccbOriginalDom: OwnerSnapshot[] | undefined;
}

function snapshot(owner: object, keys?: readonly PropertyKey[]): OwnerSnapshot
{
	const descriptors = new Map<PropertyKey, PropertyDescriptor>();
	const accessorValues = new Map<PropertyKey, unknown>();
	for (const key of keys ?? Reflect.ownKeys(owner))
	{
		const descriptor = Reflect.getOwnPropertyDescriptor(owner, key);
		if (descriptor === undefined) continue;
		descriptors.set(key, descriptor);
		if (keys !== undefined && descriptor.get !== undefined && descriptor.set !== undefined)
			accessorValues.set(key, Reflect.get(owner, key));
	}
	return keys === undefined
		?
			{
				owner,
				descriptors,
				accessorValues,
			}
		:
			{
				owner,
				descriptors,
				accessorValues,
				keys,
			};
}

function sameDescriptor(first: PropertyDescriptor, second: PropertyDescriptor): boolean
{
	return (
		first.value === second.value &&
		first.get === second.get &&
		first.set === second.set &&
		first.writable === second.writable &&
		first.enumerable === second.enumerable &&
		first.configurable === second.configurable
	);
}

/**
 * Remembers the DOM prototypes, document, navigator and DOM globals the first time the setup file runs in a jsdom worker,
 * after the setup's own patches and before any test file can change them; a shared worker keeps that first capture.
 */
export function captureDomGlobals(): void
{
	if (globalThis.ccbOriginalDom !== undefined) return;
	globalThis.ccbOriginalDom = [...domOwners().map((owner) => snapshot(owner)), snapshot(globalThis, GLOBAL_NAMES)];
}

/** Puts back every DOM property a file overrode, deleted or added by hand, as a fresh worker would start the next file. */
export function restoreDomGlobals(): void
{
	captureDomGlobals();
	for (const {owner, descriptors, accessorValues, keys} of globalThis.ccbOriginalDom ?? [])
	{
		for (const key of keys ?? new Set([...descriptors.keys(), ...Reflect.ownKeys(owner)]))
		{
			const original = descriptors.get(key);
			const current = Reflect.getOwnPropertyDescriptor(owner, key);
			if (original === undefined)
			{
				if (current !== undefined) Reflect.deleteProperty(owner, key);
			}
			else if (current === undefined || !sameDescriptor(original, current))
			{
				Object.defineProperty(owner, key, original);
			}
			if (accessorValues.has(key) && Reflect.get(owner, key) !== accessorValues.get(key))
				Reflect.set(owner, key, accessorValues.get(key));
		}
	}
}
