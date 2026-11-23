import {afterAll, afterEach, beforeAll, vi} from "vite-plus/test";
import {resetAnsweredApprovals} from "../src/lib/answered-approvals";
import {resetAnsweredSessions} from "../src/lib/answered-sessions";
import {resetBackgroundTaskViews} from "../src/lib/background-task-focus";
import {resetThumbStore} from "../src/lib/palette-thumb-store";
import {resetDefaultJourneyTracker} from "../src/lib/perf/journey";
import {resetQuestionCardStore} from "../src/lib/question-card-store";
import {resetRequestHold} from "../src/lib/server-shutdown";
import {resetSessionUndo} from "../src/lib/session-undo";
import {resetTerminalCommandsMarked} from "../src/lib/terminal-marked-store";
import {__unreadStoreTesting} from "../src/lib/unread-store";
import {captureDomGlobals, restoreDomGlobals} from "./dom-globals";
import {isolateGitEnvironment} from "./git-fixture";
import {captureWorkerGlobals, restoreWorkerGlobals} from "./worker-globals";

// Runs before every test file, so no test or code under test inherits a GIT_DIR
// that points git at the developer's repository, and no git it spawns starts an
// fsmonitor daemon that outlives the test.
isolateGitEnvironment();

// jsdom logs "Not implemented: window.scrollTo" on every call; layout-free tests have nothing to scroll.
if (typeof window !== "undefined")
	window.scrollTo = () =>
	{
	};

// jsdom does not implement Element.scrollIntoView, which every supported browser has.
if (typeof window !== "undefined")
	Element.prototype.scrollIntoView = () =>
	{
	};

// jsdom does not implement Range.getClientRects / getBoundingClientRect, which CodeMirror's measure pass reads.
if (typeof window !== "undefined" && typeof Range.prototype.getClientRects !== "function")
{
	Object.defineProperties(
		Range.prototype,
		{
			getClientRects:
			{
				configurable: true,
				writable: true,
				value: () => [],
			},
			getBoundingClientRect:
			{
				configurable: true,
				writable: true,
				value: () => new DOMRect(),
			},
		},
	);
}

// jsdom does not implement navigator.sendBeacon, which the perf journey tracker's flush timer calls;
// a timer that outlives a slow test would otherwise throw an unhandled error into a later file.
if (typeof navigator !== "undefined" && typeof navigator.sendBeacon !== "function")
{
	navigator.sendBeacon = () => true;
}

// The answer stores keep holds, marks and drafts at module level, as do the Background tasks pane's view state, the ⌘K
// thumbs that loaded, the terminal-marked flag, the unread marks, the perf tracker's queue and the server's request hold
// (on globalThis), and a shared pool runs every file in one module graph, so a test that answers a card would leak into
// the next file (a leaked request hold makes a later expectRequestHold() a no-op). Reset them after every
// test, after Testing Library's unmount below (after-hooks run in reverse registration order), as a fresh page would.
afterEach(() =>
{
	resetAnsweredSessions();
	resetAnsweredApprovals();
	resetQuestionCardStore();
	resetSessionUndo();
	resetBackgroundTaskViews();
	resetThumbStore();
	resetTerminalCommandsMarked();
	__unreadStoreTesting.reset();
	resetDefaultJourneyTracker();
	resetRequestHold();
});

declare global
{
	interface Window
	{
		/** The animation frames still queued, kept on the window so a shared-dom worker's rerun of this file finds them. */
		ccbPendingAnimationFrames?: Set<number>;
		/** The empty React root setup releases a stuck press on, kept on the window so a rerun of this file reuses it. */
		ccbPressReleaseTarget?: HTMLElement;
	}
}

// Put back real timers, the real clock and every global a file stubbed, as a fresh worker would start the next file.
// Per file, not per test: several files fake the clock or stub globals once in beforeAll for all their tests.
afterAll(() =>
{
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// A file that swaps localStorage or sessionStorage for a fake or a throwing getter would hand it to the next file in a
// shared worker, where the beforeAll below clears storage first and crashes on a throwing getter, and a fetch spy it
// never restored would answer a later file's requests (a sidebar would load Recents and start its row-count timer).
// Remember the worker's own storage and fetch before any file runs, in every environment, and put them back after each file.
captureWorkerGlobals();
afterAll(() =>
{
	restoreWorkerGlobals();
});

// findBy* and waitFor give up after Testing Library's default 1s, which a render on a machine at load average 100+
// overran (session-summary-placement's "2 subagents" link), so a commit's git test failed and an unchanged retest passed.
// A passing query still returns as soon as it matches; only a real failure waits the extra seconds.
if (typeof window !== "undefined")
{
	const {cleanup, configure} = await import("@testing-library/react");
	configure(
		{
			asyncUtilTimeout: 5000,
		},
	);
	// Testing Library registers its afterEach cleanup and turns on React's act environment when it is first imported,
	// and a shared-dom worker imports it once for all its files. Register both for every file, as an isolated worker would.
	// The shared window also keeps what the previous file left in storage, which a fresh jsdom starts without.
	beforeAll(() =>
	{
		Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
		localStorage.clear();
		sessionStorage.clear();
		// Base UI's modal scroll lock writes overflow onto <html> and <body> on a zero-delay timeout, so a modal a
		// previous file left opening locks the shared page after its unmount. Start each file with unstyled roots.
		document.documentElement.removeAttribute("style");
		document.body.removeAttribute("style");
	});
	// A frame a test leaves queued outlives its unmount: Base UI's menus focus their highlighted item in a
	// requestAnimationFrame, which then lands in a later test and spends a focus() call there. Track pending frames
	// and drop them after cleanup (registered first, so it runs after cleanup and catches frames an unmount queues),
	// as leaving the page would. Wrap once: a shared-dom worker runs this file again for every test file.
	// Base UI batches its frames through one module-level scheduler that marks itself scheduled until its frame runs, so
	// cancelling that frame would leave it marked forever and no Base UI frame callback (transition status, open-change
	// complete) would run again in this worker. Replace the scheduler too, dropping what it held as leaving the page would.
	const pendingFrames = trackAnimationFrames(window);
	const {resetAnimationFrameScheduler} = await import("@base-ui/utils/useAnimationFrame");
	afterEach(() =>
	{
		for (const id of pendingFrames) window.cancelAnimationFrame(id);
		pendingFrames.clear();
		resetAnimationFrameScheduler();
	});
	// Cleanup only unmounts what render() mounted; a test that writes document.body itself leaves its nodes for the
	// next file in a shared-dom worker, which one that runs there depends on scheduling. Empty the body after cleanup.
	afterEach(() =>
	{
		document.body.replaceChildren();
	});
	// A range a test leaves selected stays in the shared document, and addRange is ignored while one is held, so a later
	// test's selection would silently never land. Clear it, as a fresh page would start with nothing selected.
	afterEach(() =>
	{
		document.getSelection()?.removeAllRanges();
	});
	// The approval slot's focus tracker stamps the window's focus and blur events with performance.now(), per window, so
	// the real-clock times one file stamped read as "just regained focus" to a later file's fake clock and refuse its
	// fresh picks. Forget them, and any landing, as a fresh page would.
	const {resetLandingWindow} = await import("../src/lib/approval-slot-landing");
	afterEach(() =>
	{
		resetLandingWindow(window);
	});
	// The window's one presence watcher marks it away for good after a window blur while the page holds focus, which
	// jsdom always reports, so a file that blurs the window would leave type-to-focus off for every later file in a
	// shared-dom worker. Forget it, as a fresh page starts present.
	const {forgetPresence} = await import("../src/lib/stray-input-presence");
	afterEach(() =>
	{
		forgetPresence(window);
	});
	// A menu pin requests the "drag to pin" coach mark in a module-level flag, which keeps a later file's empty Pinned
	// section open as the hint instead of an inert stub. Close it, as a fresh page starts without the request.
	const {closeDragPinHint} = await import("../src/lib/drag-pin-hint");
	afterEach(() =>
	{
		closeDragPinHint();
	});
	// The sidebar writes its Recents row count on a 2s debounce, so a list a test unmounts can still write it into a
	// later file's storage in a shared-dom worker. Drop the pending write, as leaving the page would.
	const {cancelPendingRecentsRowCount} = await import("../src/lib/sidebar-store");
	afterEach(() =>
	{
		cancelPendingRecentsRowCount();
	});
	// React's onSelect polyfill holds a module-level "mouse is down" flag from a mousedown until a mouseup, and drops
	// every select event meanwhile, so a test that presses without releasing would silence onSelect in every later test
	// in a shared-dom worker. Release it on an empty root of its own, as the user lifting the button would.
	const releaseTarget = await pressReleaseTarget(window);
	afterEach(() =>
	{
		releaseTarget.dispatchEvent(
			new MouseEvent(
				"mouseup",
				{
					bubbles: true,
				},
			),
		);
	});
	afterEach(() =>
	{
		cleanup();
	});
	// A file that patches a DOM prototype, document, navigator or a DOM global by hand (an offsetParent getter, a deleted
	// native, an animate or ResizeObserver jsdom lacks) would hand the patch to the next file in a shared-dom worker.
	// Remember the DOM as this setup leaves it before any file runs, and put it back after each file.
	captureDomGlobals();
	afterAll(() =>
	{
		restoreDomGlobals();
	});
}

async function pressReleaseTarget(win: Window): Promise<HTMLElement>
{
	if (win.ccbPressReleaseTarget !== undefined) return win.ccbPressReleaseTarget;
	const {createRoot} = await import("react-dom/client");
	const target = win.document.createElement("div");
	// createRoot attaches React's event listeners to the container; nothing is ever rendered into it.
	createRoot(target);
	win.ccbPressReleaseTarget = target;
	return target;
}

function trackAnimationFrames(win: Window): Set<number>
{
	if (win.ccbPendingAnimationFrames !== undefined) return win.ccbPendingAnimationFrames;
	const pending = new Set<number>();
	const request = win.requestAnimationFrame.bind(win);
	const cancel = win.cancelAnimationFrame.bind(win);
	win.requestAnimationFrame = (callback) =>
	{
		const id = request((time) =>
		{
			pending.delete(id);
			callback(time);
		});
		pending.add(id);
		return id;
	};
	win.cancelAnimationFrame = (id) =>
	{
		pending.delete(id);
		cancel(id);
	};
	win.ccbPendingAnimationFrames = pending;
	return pending;
}
