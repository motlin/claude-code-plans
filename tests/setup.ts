import {scrubGitEnvironment} from "./git-fixture";

// Runs before every test file, so no test or code under test inherits a GIT_DIR
// that points git at the developer's repository.
scrubGitEnvironment();
