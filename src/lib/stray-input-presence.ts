/**
 * Upstream's per-window presence state (shared-0 `lP`/`TE`/`YAf`/`Ya`): once focus has been inside an iframe, a
 * stray key or paste on the page may be meant for the frame, so type-to-focus waits ("away") until the user presses
 * and clicks somewhere in the page again. A plain app switch doesn't start the wait.
 *
 * Ported without the parts the local app has no use for: the page-activation and `marked` starts, the
 * `data-own-key-here-ends-the-wait` keyboard exit (upstream doesn't put it on the session composer), the
 * strayInputDropped telemetry and nudge (a Claude Code session drops silently), and the GrowthBook bypass (off).
 */

/** Upstream's `pR`: elements whose focus means the keys go to another document. */
const FRAME_NODE_NAMES = new Set(["IFRAME", "FRAME", "OBJECT", "EMBED", "WEBVIEW"]);

/** Upstream's `n1`: how close a press must be to its click, and how long after the window gains focus a press doesn't count. */
const PRESS_WINDOW_MS = 1000;

/** Upstream's `Zc`. jsdom can't make trusted events, so tests replace this. */
export const presenceTrust =
{
	isTrusted: (event: Event): boolean => event.isTrusted,
};

export interface Presence
{
	/** Upstream's `aX`: no wait is in force. */
	isPresent(): boolean;
	dispose(): void;
}

/** Upstream's `NE`. */
function isFrame(target: EventTarget | null): boolean
{
	return target instanceof Element && FRAME_NODE_NAMES.has(target.nodeName);
}

/** Upstream's `bA`: a press or click on a toast doesn't count as coming back to the page. */
function isOffToast(event: Event): boolean
{
	return !(event.target instanceof Element) || event.target.closest('[data-cds="Toast"]') === null;
}

/** Upstream's `TE`, as one disposable watcher. */
export function watchPresence(win: Window): Presence
{
	const doc = win.document;
	let leftAt = -Infinity;
	let pointerAt = -Infinity;
	let gainedAt = -Infinity;
	let pressAt = -Infinity;
	let pressHandledAt = -Infinity;
	const trusted = (event: Event) => presenceTrust.isTrusted(event);
	const leave = () =>
	{
		leftAt = performance.now();
	};
	const timers = new Set<number>();
	const controller = new AbortController();
	const options =
	{
		signal: controller.signal,
	};
	const captureOptions =
	{
		signal: controller.signal,
		capture: true,
	};

	win.addEventListener(
		"focus",
		(event) =>
		{
			if (isFrame(doc.activeElement)) leave();
			if (trusted(event)) gainedAt = performance.now();
		},
		options,
	);
	win.addEventListener(
		"blur",
		() =>
		{
			const at = performance.now();
			if (doc.hasFocus() || isFrame(doc.activeElement))
			{
				leftAt = at;
				return;
			}
			const timer = win.setTimeout(() =>
			{
				timers.delete(timer);
				if (isFrame(doc.activeElement)) leftAt = at;
			}, 0);
			timers.add(timer);
		},
		options,
	);
	doc.addEventListener(
		"visibilitychange",
		() =>
		{
			if (isFrame(doc.activeElement)) leave();
		},
		options,
	);
	for (const type of ["focusin", "focusout"])
	{
		doc.addEventListener(
			type,
			(event) =>
			{
				if (isFrame(event.target)) leave();
			},
			captureOptions,
		);
	}
	win.addEventListener(
		"pointerdown",
		(event) =>
		{
			if (!trusted(event)) return;
			const now = performance.now();
			pressAt = now - gainedAt <= PRESS_WINDOW_MS || !isOffToast(event) ? -Infinity : now;
			pressHandledAt = now;
		},
		captureOptions,
	);
	win.addEventListener(
		"pointercancel",
		(event) =>
		{
			if (trusted(event)) pressAt = -Infinity;
		},
		captureOptions,
	);
	win.addEventListener(
		"click",
		(event) =>
		{
			if (!trusted(event)) return;
			const now = performance.now();
			if (
				event.detail > 0 &&
				now - pressAt <= PRESS_WINDOW_MS &&
				now - pressHandledAt <= PRESS_WINDOW_MS &&
				!isFrame(doc.activeElement) &&
				isOffToast(event)
			)
			{
				pointerAt = now;
			}
			pressAt = -Infinity;
		},
		captureOptions,
	);
	if (isFrame(doc.activeElement)) leave();

	return {
		isPresent: () => leftAt === -Infinity || pointerAt > leftAt,
		dispose: () =>
		{
			controller.abort();
			for (const timer of timers) win.clearTimeout(timer);
			timers.clear();
		},
	};
}

const presences = new WeakMap<Window, Presence>();

/** The window's one shared presence watcher, started on first use and kept for the window's life (upstream's `Rm`). */
export function presenceOf(win: Window): Presence
{
	let presence = presences.get(win);
	if (presence === undefined)
	{
		presence = watchPresence(win);
		presences.set(win, presence);
	}
	return presence;
}
