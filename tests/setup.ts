import {isolateGitEnvironment} from "./git-fixture";

// Runs before every test file, so no test or code under test inherits a GIT_DIR
// that points git at the developer's repository, and no git it spawns starts an
// fsmonitor daemon that outlives the test.
isolateGitEnvironment();

// jsdom logs "Not implemented: window.scrollTo" on every call; layout-free tests have nothing to scroll.
if (typeof window !== "undefined") window.scrollTo = () => {};

// jsdom does not implement Element.scrollIntoView, which every supported browser has.
if (typeof window !== "undefined") Element.prototype.scrollIntoView = () => {};
