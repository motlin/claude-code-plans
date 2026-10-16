import {describe, expect, it} from "vite-plus/test";
import {createHerdrPaneTable, type HerdrPaneState} from "../src/lib/herdr/pane-table";

type WirePane = HerdrPaneState["panes"][number];
type WireWorkspace = HerdrPaneState["workspaces"][number];

function wirePane(paneId: string, overrides: Partial<WirePane> = {}): WirePane {
	const workspaceId = paneId.split(":")[0] ?? paneId;
	return {
		pane_id: paneId,
		terminal_id: `terminal-${paneId}`,
		workspace_id: workspaceId,
		tab_id: `${workspaceId}:t1`,
		focused: false,
		agent: "claude",
		agent_status: "idle",
		revision: 1,
		...overrides,
	};
}

function wireWorkspace(workspaceId: string, agentStatus: string): WireWorkspace {
	return {
		workspace_id: workspaceId,
		number: 1,
		label: `Workspace ${workspaceId}`,
		focused: false,
		pane_count: 1,
		tab_count: 1,
		active_tab_id: `${workspaceId}:t1`,
		agent_status: agentStatus,
	};
}

function seededTable() {
	const table = createHerdrPaneTable();
	table.seed({
		workspaces: [wireWorkspace("w1", "idle"), wireWorkspace("w2", "working")],
		panes: [wirePane("w1:p1"), wirePane("w2:p2", {agent_status: "working", revision: 5})],
	});
	return table;
}

describe("herdr pane table", () => {
	it("is not current until seeded and stops being current when invalidated", () => {
		const table = createHerdrPaneTable();
		const before = table.current();
		const state = {workspaces: [wireWorkspace("w1", "idle")], panes: [wirePane("w1:p1")]};
		table.seed(state);
		const seeded = table.current();
		table.invalidate();
		const invalidated = table.current();
		table.seed(state);

		expect({before, seeded, invalidated, reseeded: table.current()}).toStrictEqual({
			before: null,
			seeded: state,
			invalidated: null,
			reseeded: state,
		});
	});

	it("keeps its own copy of the seeded snapshot", () => {
		const table = createHerdrPaneTable();
		const panes = [wirePane("w1:p1")];
		table.seed({workspaces: [], panes});
		panes.push(wirePane("w1:p2"));

		expect(table.current()).toStrictEqual({workspaces: [], panes: [wirePane("w1:p1")]});
	});

	it("adds created panes, applies newer updates, and drops closed panes", () => {
		const table = seededTable();
		table.apply("pane_created", {pane: wirePane("w1:p3", {revision: 0})});
		table.apply("pane_updated", {pane: wirePane("w2:p2", {agent_status: "working", focused: true, revision: 6})});
		// A replayed older revision and an update for a pane the table never saw are both ignored.
		table.apply("pane_updated", {pane: wirePane("w2:p2", {agent_status: "idle", revision: 4})});
		table.apply("pane_updated", {pane: wirePane("w9:p9", {revision: 9})});
		table.apply("pane_closed", {pane_id: "w1:p1", workspace_id: "w1"});

		expect(table.current()?.panes).toStrictEqual([
			wirePane("w2:p2", {agent_status: "working", focused: true, revision: 6}),
			wirePane("w1:p3", {revision: 0}),
		]);
	});

	it("replaces a moved pane under its new id", () => {
		const table = seededTable();
		table.apply("pane_moved", {
			previous_pane_id: "w1:p1",
			previous_workspace_id: "w1",
			previous_tab_id: "w1:t1",
			pane: wirePane("w2:p7", {terminal_id: "terminal-w1:p1", revision: 2}),
		});

		expect(table.current()?.panes).toStrictEqual([
			wirePane("w2:p2", {agent_status: "working", revision: 5}),
			wirePane("w2:p7", {terminal_id: "terminal-w1:p1", revision: 2}),
		]);
	});

	it("patches agent status and detection and rederives the workspace status by attention", () => {
		const table = seededTable();
		table.apply("pane_agent_status_changed", {
			pane_id: "w1:p1",
			workspace_id: "w1",
			agent_status: "blocked",
			agent: "claude",
			title: "Needs input",
		});
		table.apply("pane_agent_detected", {pane_id: "w2:p2", workspace_id: "w2", agent: "codex"});
		table.apply("pane_agent_status_changed", {pane_id: "w2:p2", workspace_id: "w2", agent_status: "done"});

		expect(table.current()).toStrictEqual({
			workspaces: [wireWorkspace("w1", "blocked"), wireWorkspace("w2", "done")],
			panes: [
				wirePane("w1:p1", {agent_status: "blocked", title: "Needs input"}),
				wirePane("w2:p2", {agent: "codex", agent_status: "done", revision: 5}),
			],
		});
	});

	it("ignores events while it is not current and malformed payloads", () => {
		const table = createHerdrPaneTable();
		table.apply("pane_created", {pane: wirePane("w1:p1")});
		const unseeded = table.current();
		table.seed({workspaces: [], panes: []});
		table.apply("pane_created", {pane: {pane_id: "w1:p1"}});
		table.apply("pane_agent_status_changed", {pane_id: "w1:p1"});

		expect({unseeded, seeded: table.current()}).toStrictEqual({
			unseeded: null,
			seeded: {workspaces: [], panes: []},
		});
	});
});
