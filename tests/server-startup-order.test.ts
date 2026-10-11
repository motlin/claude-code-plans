import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

/**
 * Live session state must not wait on the slow startup steps: with the
 * registry monitor started after the initial scan, every session read
 * Completed for the scan's whole duration on real data.
 */
describe("server startup order", () => {
	const source = readFileSync(join(__dirname, "..", "src", "server.ts"), "utf8");
	const at = (needle: string) => source.indexOf(needle);

	it("starts the session registry monitor right after the database opens, before the slow scans", () => {
		const monitor = at("startSessionRegistryMonitor({");
		expect({
			found: monitor > 0,
			afterDb: monitor > at('"startup open database"'),
			beforePendingApprovals: monitor < at('"startup pending-approvals scan"'),
			beforeWatcher: monitor < at('"startup watcher"'),
			beforeInitialScan: monitor < at('"startup initial scan"'),
		}).toStrictEqual({
			found: true,
			afterDb: true,
			beforePendingApprovals: true,
			beforeWatcher: true,
			beforeInitialScan: true,
		});
	});
});
