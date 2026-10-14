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
