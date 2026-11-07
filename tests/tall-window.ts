const TALL_WINDOW_QUERY = "(min-height: 30rem)";

type Listener = (event: {matches: boolean}) => void;

/**
 * A `window.matchMedia` stand-in for `(min-height: 30rem)` (upstream `An()`, the dialog tall-window query).
 * Assigned rather than stubbed so a test file using it can stay in the shared jsdom pool; call `restore`
 * in afterEach. `setMatches` fires the query's `change` listeners.
 */
export function mockTallWindow(initial: boolean): {setMatches: (matches: boolean) => void; restore: () => void} {
	const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
	const listeners = new Set<Listener>();
	let matches = initial;
	const query = (media: string) => ({
		get matches() {
			return media === TALL_WINDOW_QUERY && matches;
		},
		media,
		addEventListener: (_type: string, listener: Listener) => {
			if (media === TALL_WINDOW_QUERY) listeners.add(listener);
		},
		removeEventListener: (_type: string, listener: Listener) => {
			listeners.delete(listener);
		},
	});
	Object.defineProperty(window, "matchMedia", {configurable: true, writable: true, value: query});
	return {
		setMatches: (next) => {
			matches = next;
			for (const listener of listeners) listener({matches: next});
		},
		restore: () => {
			if (original === undefined) Reflect.deleteProperty(window, "matchMedia");
			else Object.defineProperty(window, "matchMedia", original);
		},
	};
}
