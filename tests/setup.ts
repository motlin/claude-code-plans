import {afterEach, beforeAll} from "vite-plus/test";
import {isolateGitEnvironment} from "./git-fixture";

// Runs before every test file, so no test or code under test inherits a GIT_DIR
// that points git at the developer's repository, and no git it spawns starts an
// fsmonitor daemon that outlives the test.
isolateGitEnvironment();

// jsdom logs "Not implemented: window.scrollTo" on every call; layout-free tests have nothing to scroll.
if (typeof window !== "undefined") window.scrollTo = () => {};

// jsdom does not implement Element.scrollIntoView, which every supported browser has.
if (typeof window !== "undefined") Element.prototype.scrollIntoView = () => {};

// jsdom does not implement navigator.sendBeacon, which the perf journey tracker's flush timer calls;
// a timer that outlives a slow test would otherwise throw an unhandled error into a later file.
if (typeof navigator !== "undefined" && typeof navigator.sendBeacon !== "function") {
	navigator.sendBeacon = () => true;
}

// findBy* and waitFor give up after Testing Library's default 1s, which a render on a machine at load average 100+
// overran (session-summary-placement's "2 subagents" link), so a commit's git test failed and an unchanged retest passed.
// A passing query still returns as soon as it matches; only a real failure waits the extra seconds.
if (typeof window !== "undefined") {
	const {cleanup, configure} = await import("@testing-library/react");
	configure({asyncUtilTimeout: 5000});
	// Testing Library registers its afterEach cleanup and turns on React's act environment when it is first imported,
	// and a shared-dom worker imports it once for all its files. Register both for every file, as an isolated worker would.
	// The shared window also keeps what the previous file left in storage, which a fresh jsdom starts without.
	beforeAll(() => {
		Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
		localStorage.clear();
		sessionStorage.clear();
	});
	afterEach(() => {
		cleanup();
	});
}
