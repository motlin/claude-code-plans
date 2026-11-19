// Globals every environment has that files replace for a test: the storage pair (a fake, or a throwing getter) and fetch
// (vi.spyOn, which vi.unstubAllGlobals does not undo). Node's fetch and localStorage are lazy accessors, so restore the
// descriptor, not the value.
const WORKER_GLOBAL_NAMES = ["localStorage", "sessionStorage", "fetch"] as const;

type WorkerGlobalDescriptors = Partial<Record<(typeof WORKER_GLOBAL_NAMES)[number], PropertyDescriptor>>;

declare global
{
	/** The worker's own globals, kept on globalThis so a shared worker's rerun of the setup file finds them. */
	var ccbOriginalWorkerGlobals: WorkerGlobalDescriptors | undefined;
}

/**
 * Remembers the worker's own localStorage, sessionStorage and fetch the first time the setup file runs in a worker,
 * before any test file can redefine them; a shared worker reruns the setup for every file and keeps the first capture.
 */
export function captureWorkerGlobals(): void
{
	if (globalThis.ccbOriginalWorkerGlobals !== undefined) return;
	const original: WorkerGlobalDescriptors = {};
	for (const name of WORKER_GLOBAL_NAMES)
	{
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
		if (descriptor !== undefined) original[name] = descriptor;
	}
	globalThis.ccbOriginalWorkerGlobals = original;
}

/** Puts back the worker globals a file redefined or spied on, as a fresh worker would start the next file. */
export function restoreWorkerGlobals(): void
{
	captureWorkerGlobals();
	const original = globalThis.ccbOriginalWorkerGlobals ?? {};
	for (const name of WORKER_GLOBAL_NAMES)
	{
		const descriptor = original[name];
		if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
		else Object.defineProperty(globalThis, name, descriptor);
	}
}
