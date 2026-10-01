import {isolateGitEnvironment} from "./git-fixture";

// Runs before every test file, so no test or code under test inherits a GIT_DIR
// that points git at the developer's repository, and no git it spawns starts an
// fsmonitor daemon that outlives the test.
isolateGitEnvironment();
