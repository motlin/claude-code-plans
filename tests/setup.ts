import {afterAll, afterEach, beforeAll, vi} from "vite-plus/test";
import {resetAnsweredApprovals} from "../src/lib/answered-approvals";
import {resetAnsweredSessions} from "../src/lib/answered-sessions";
import {resetQuestionCardStore} from "../src/lib/question-card-store";
import {isolateGitEnvironment} from "./git-fixture";
import {captureStorageGlobals, restoreStorageGlobals} from "./storage-globals";

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

// jsdom does not implement navigator.sendBeacon, which the perf journey tracker's flush timer calls;
// a timer that outlives a slow test would otherwise throw an unhandled error into a later file.
if (typeof navigator !== "undefined" && typeof navigator.sendBeacon !== "function")
{
	navigator.sendBeacon = () => true;
}

// The answer stores keep holds, marks and drafts at module level, and a shared pool runs every file in one module
// graph, so a test that answers a card would leak into the next file. Reset them after every test, after Testing
// Library's unmount below (after-hooks run in reverse registration order), as a fresh page would start.
afterEach(() =>
{
	resetAnsweredSessions();
	resetAnsweredApprovals();
	resetQuestionCardStore();
});

declare global
{
	interface Window
	{
		/** The animation frames still queued, kept on the window so a shared-dom worker's rerun of this file finds them. */
		ccbPendingAnimationFrames?: Set<number>;
	}
}

// Put back real timers and the real clock a file left faked, as a fresh worker would start the next file. Per file,
// not per test: several files fake the clock once in beforeAll for all their tests.
afterAll(() =>
{
	vi.useRealTimers();
});

// A file that swaps localStorage or sessionStorage for a fake or a throwing getter would hand it to the next file in a
// shared worker, where the beforeAll below clears storage first and crashes on a throwing getter. Remember the
// worker's own storage before any file runs and put it back after each file.
captureStorageGlobals();
afterAll(() =>
{
	restoreStorageGlobals();
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
	afterEach(() =>
	{
		cleanup();
	});
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
