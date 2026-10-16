import {describe, expect, it} from "vite-plus/test";
import {createTmuxPaneTable, TMUX_PANE_TABLE_MAX_AGE_MS} from "../src/lib/tmux/pane-table";
import type {TmuxSessionPane} from "../src/lib/tmux/session-panes";

const alice: TmuxSessionPane = {
	sessionId: "session-test-alice",
	cwd: "/tmp/test/alice-project",
	via: "env",
	pane: {
		paneId: "%1",
		panePid: 101,
		socketPath: "/private/tmp/tmux-501/default",
		sessionName: "main",
		windowIndex: 1,
		windowName: "claude",
		windowActive: true,
		paneActive: true,
		currentPath: "/tmp/test/alice-project",
	},
};

function clockedTable() {
	let now = 1_000_000;
	const table = createTmuxPaneTable(() => now);
	return {
		table,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("tmux pane table", () => {
	it("is not current before the poller fills it", () => {
		const {table} = clockedTable();

		expect(table.current()).toBeNull();
	});

	it("serves the last poll's panes until they are older than the max age", () => {
		const {table, advance} = clockedTable();
		table.update([alice]);
		advance(TMUX_PANE_TABLE_MAX_AGE_MS);
		const fresh = table.current();
		advance(1);

		expect({fresh, stale: table.current()}).toStrictEqual({fresh: [alice], stale: null});
	});

	it("holds panes with no expiry, as the poller does once tmux is not installed", () => {
		const {table, advance} = clockedTable();
		table.hold([]);
		advance(TMUX_PANE_TABLE_MAX_AGE_MS * 100);

		expect(table.current()).toStrictEqual([]);
	});

	it("stops being current once invalidated", () => {
		const {table} = clockedTable();
		table.hold([alice]);
		table.invalidate();

		expect(table.current()).toBeNull();
	});
});
