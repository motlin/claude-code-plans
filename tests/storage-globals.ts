const STORAGE_NAMES = ["localStorage", "sessionStorage"] as const;

type StorageDescriptors = Partial<Record<(typeof STORAGE_NAMES)[number], PropertyDescriptor>>;

declare global {
	/** The worker's own storage globals, kept on globalThis so a shared worker's rerun of the setup file finds them. */
	var ccbOriginalStorage: StorageDescriptors | undefined;
}

/**
 * Remembers the worker's own localStorage and sessionStorage the first time the setup file runs in a worker, before any
 * test file can redefine them; a shared worker reruns the setup for every file and keeps the first capture.
 */
export function captureStorageGlobals(): void {
	if (globalThis.ccbOriginalStorage !== undefined) return;
	const original: StorageDescriptors = {};
	for (const name of STORAGE_NAMES) {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
		if (descriptor !== undefined) original[name] = descriptor;
	}
	globalThis.ccbOriginalStorage = original;
}

/** Puts back the storage globals a file redefined (a fake, or a throwing getter), as a fresh worker would start the next file. */
export function restoreStorageGlobals(): void {
	captureStorageGlobals();
	const original = globalThis.ccbOriginalStorage ?? {};
	for (const name of STORAGE_NAMES) {
		const descriptor = original[name];
		if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
		else Object.defineProperty(globalThis, name, descriptor);
	}
}
