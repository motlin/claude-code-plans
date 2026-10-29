import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it, vi} from "vite-plus/test";
import {
	handleHerdrPlan,
	handleHerdrPlanDialog,
	parsePlanDialog,
	planDecisionSteps,
	type HerdrPlanDependencies,
} from "../src/lib/herdr/plan";
import type {HerdrRequester} from "../src/lib/herdr/panes";
import {rejectCrossSite} from "../src/lib/same-origin-guard";

/** A real CLI 2.1.302 plan approval dialog, read from a throwaway session's herdr pane. */
const AUTO_SCREEN = readFileSync(join(import.meta.dirname, "fixtures/plan-approval-dialog.txt"), "utf8");

function dialogScreen(rows: string[]): string {
	return [
		"   Claude has written up a plan and is ready to execute. Would you like to proceed?",
		"",
		...rows.map((label, index) => `   ${index === 0 ? "❯" : " "} ${index + 1}. ${label}`),
		"        shift+tab to approve with this feedback",
		"",
		"   ctrl+g to edit in Vim · ~/.claude/plans/test-plan.md",
	].join("\n");
}

describe("parsePlanDialog", () => {
	it("reads the real dialog's auto-mode, manual and feedback rows", () => {
		expect(parsePlanDialog(AUTO_SCREEN)).toStrictEqual({
			forward: {mode: "auto", row: 1},
			manual: 2,
			feedback: 3,
		});
	});

	it.each([
		{label: "Yes, auto-accept edits", mode: "acceptEdits"},
		{label: "Yes, and auto-accept edits", mode: "acceptEdits"},
		{label: "Yes, and bypass permissions", mode: "bypassPermissions"},
	])("maps '$label' to $mode", ({label, mode}) => {
		expect(
			parsePlanDialog(dialogScreen([label, "Yes, manually approve edits", "Tell Claude what to change"])),
		).toStrictEqual({forward: {mode, row: 1}, manual: 2, feedback: 3});
	});

	it("skips clear-context rows it does not offer, keeping the keep-context rows' numbers", () => {
		expect(
			parsePlanDialog(
				dialogScreen([
					"Yes, clear context (41% used) and use auto mode",
					"Yes, and use auto mode",
					"Yes, manually approve edits",
					"Tell Claude what to change",
				]),
			),
		).toStrictEqual({forward: {mode: "auto", row: 2}, manual: 3, feedback: 4});
	});

	it.each([
		{name: "no dialog on screen", screen: "❯ \n  ⏸ plan mode on (shift+tab to cycle)"},
		{
			name: "text already typed into the feedback row",
			screen: dialogScreen(["Yes, and use auto mode", "Yes, manually approve edits", "use bye instead"]),
		},
		{
			name: "the plan-less exit dialog",
			screen: [
				"   Exit plan mode?",
				"    Claude wants to exit plan mode",
				"    ❯ 1. Yes, and switch to default (ask each time) for this session",
				"      2. No",
			].join("\n"),
		},
		{
			name: "rows out of order",
			screen: dialogScreen(["Yes, and use auto mode", "Tell Claude what to change"]).replace(
				"2. Tell",
				"3. Tell",
			),
		},
	])("refuses $name", ({screen}) => {
		expect(parsePlanDialog(screen)).toStrictEqual(null);
	});
});

describe("planDecisionSteps", () => {
	const dialog = {forward: {mode: "auto" as const, row: 1}, manual: 2, feedback: 3};

	it.each([
		{name: "accept in the forward mode", decision: {kind: "accept", mode: "auto"}, steps: [{key: "1"}]},
		{name: "accept with manual approval", decision: {kind: "accept", mode: "default"}, steps: [{key: "2"}]},
		{
			name: "reject without feedback",
			decision: {kind: "reject", feedback: "  "},
			steps: [{key: "3"}, {key: "enter"}],
		},
		{
			name: "revise with one-line feedback, typed into the dialog's own field",
			decision: {kind: "reject", feedback: " use  bye\tinstead "},
			steps: [{key: "3"}, {text: "use bye instead"}, {key: "enter"}],
		},
		{
			// A bracketed paste keeps the newlines in the field without submitting (verified on CLI 2.1.312).
			name: "revise with multi-line feedback, pasted so its newlines are kept",
			decision: {kind: "reject", feedback: "On selected text:\n> x\ny\n"},
			steps: [{key: "3"}, {text: "\u001b[200~On selected text:\n> x\ny\u001b[201~"}, {key: "enter"}],
		},
	] as const)("$name", ({decision, steps}) => {
		expect(planDecisionSteps(dialog, decision)).toStrictEqual(steps);
	});

	it("refuses a forward mode the dialog does not offer", () => {
		expect(planDecisionSteps(dialog, {kind: "accept", mode: "acceptEdits"})).toStrictEqual(null);
	});

	it("refuses manual approval when the dialog has no such row", () => {
		expect(planDecisionSteps({...dialog, manual: null}, {kind: "accept", mode: "default"})).toStrictEqual(null);
	});
});

function postRequest(body: unknown, headers?: HeadersInit): Request {
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request("http://127.0.0.1:7526/api/herdr/plan", {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

function getRequest(sessionId: string): Request {
	return new Request(`http://127.0.0.1:7526/api/herdr/plan?sessionId=${sessionId}`);
}

async function describeResponse(response: Response): Promise<{body: unknown; status: number}> {
	return {body: await response.json(), status: response.status};
}

function dependencies(overrides: Partial<HerdrPlanDependencies> = {}): HerdrPlanDependencies {
	return {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		hasPendingPlan: () => true,
		clearPendingPlan: () => {},
		resolveTarget: async () => Promise.resolve({ok: true, value: {terminalId: "terminal-1", paneId: "w1:p1"}}),
		readScreen: async () => Promise.resolve({ok: true, value: AUTO_SCREEN}),
		request: async () => Promise.resolve({ok: true, value: {type: "ok"}}),
		createRequestId: () => "ccp:plan:test",
		pause: async () => Promise.resolve(),
		...overrides,
	};
}

describe("herdr plan dialog read", () => {
	it("reports the forward mode and manual row of the dialog on screen", async () => {
		const readScreen = vi.fn<HerdrPlanDependencies["readScreen"]>(async () =>
			Promise.resolve({ok: true, value: AUTO_SCREEN}),
		);
		const response = await handleHerdrPlanDialog(getRequest("session-1"), dependencies({readScreen}));
		expect({response: await describeResponse(response), reads: readScreen.mock.calls}).toStrictEqual({
			response: {body: {dialog: {forwardMode: "auto", manual: true}}, status: 200},
			reads: [["session-1", "w1:p1"]],
		});
	});

	it("refuses when no ExitPlanMode approval is pending", async () => {
		const response = await handleHerdrPlanDialog(
			getRequest("session-1"),
			dependencies({hasPendingPlan: () => false}),
		);
		expect(await describeResponse(response)).toStrictEqual({
			body: {error: "No plan approval is pending"},
			status: 409,
		});
	});

	it("refuses when the screen is not the plan approval dialog", async () => {
		const response = await handleHerdrPlanDialog(
			getRequest("session-1"),
			dependencies({readScreen: async () => Promise.resolve({ok: true, value: "❯ "})}),
		);
		expect(await describeResponse(response)).toStrictEqual({
			body: {error: "The terminal is not showing the plan approval dialog"},
			status: 409,
		});
	});
});

describe("herdr plan decision handler", () => {
	it("types the feedback into the dialog's field after picking its row, pausing between steps", async () => {
		const sendRequest = vi.fn<HerdrRequester>(async () => Promise.resolve({ok: true, value: {type: "ok"}}));
		const clearPendingPlan = vi.fn<(sessionId: string) => void>();
		const pause = vi.fn<() => Promise<void>>(async () => Promise.resolve());
		const response = await handleHerdrPlan(
			postRequest({sessionId: "session-1", decision: {kind: "reject", feedback: "use bye instead"}}),
			dependencies({request: sendRequest, clearPendingPlan, pause}),
		);
		expect({
			response: await describeResponse(response),
			calls: sendRequest.mock.calls.map(([call]) => call),
			pauses: pause.mock.calls.length,
			cleared: clearPendingPlan.mock.calls,
		}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			calls: [
				{id: "ccp:plan:test", method: "agent.send_keys", params: {target: "w1:p1", keys: ["3"]}},
				{id: "ccp:plan:test", method: "pane.send_text", params: {pane_id: "w1:p1", text: "use bye instead"}},
				{id: "ccp:plan:test", method: "agent.send_keys", params: {target: "w1:p1", keys: ["enter"]}},
			],
			pauses: 2,
			cleared: [["session-1"]],
		});
	});

	it("presses the forward row's digit to accept", async () => {
		const sendRequest = vi.fn<HerdrRequester>(async () => Promise.resolve({ok: true, value: {type: "ok"}}));
		await handleHerdrPlan(
			postRequest({sessionId: "session-1", decision: {kind: "accept", mode: "auto"}}),
			dependencies({request: sendRequest}),
		);
		expect(sendRequest.mock.calls.map(([call]) => call)).toStrictEqual([
			{id: "ccp:plan:test", method: "agent.send_keys", params: {target: "w1:p1", keys: ["1"]}},
		]);
	});

	it.each([
		{
			name: "writes are disabled",
			overrides: {writesEnabled: () => false},
			decision: {kind: "accept", mode: "auto"},
			response: {body: {error: "herdr writes are disabled"}, status: 403},
		},
		{
			name: "no plan approval is pending",
			overrides: {hasPendingPlan: () => false},
			decision: {kind: "accept", mode: "auto"},
			response: {body: {error: "No plan approval is pending"}, status: 409},
		},
		{
			name: "the screen shows another dialog",
			overrides: {readScreen: async () => Promise.resolve({ok: true as const, value: "Do you want to proceed?"})},
			decision: {kind: "accept", mode: "auto"},
			response: {body: {error: "The terminal is not showing the plan approval dialog"}, status: 409},
		},
		{
			name: "the dialog offers another forward mode",
			overrides: {},
			decision: {kind: "accept", mode: "acceptEdits"},
			response: {body: {error: "The plan approval dialog does not offer that choice"}, status: 409},
		},
	])("sends nothing when $name", async ({overrides, decision, response}) => {
		const sendRequest = vi.fn<HerdrRequester>();
		const result = await handleHerdrPlan(
			postRequest({sessionId: "session-1", decision}),
			dependencies({...overrides, request: sendRequest}),
		);
		expect({response: await describeResponse(result), calls: sendRequest.mock.calls}).toStrictEqual({
			response,
			calls: [],
		});
	});

	it("rejects a body carrying keys of its own", async () => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrPlan(
			postRequest({sessionId: "session-1", decision: {kind: "accept", mode: "auto"}, keys: ["ctrl+c"]}),
			dependencies({request: sendRequest}),
		);
		expect({status: response.status, calls: sendRequest.mock.calls}).toStrictEqual({status: 400, calls: []});
	});

	it("rejects cross-site requests", async () => {
		const response = await handleHerdrPlan(
			postRequest(
				{sessionId: "session-1", decision: {kind: "accept", mode: "auto"}},
				{Origin: "https://attacker.example.com", "Sec-Fetch-Site": "cross-site"},
			),
			dependencies(),
		);
		expect(response.status).toStrictEqual(403);
	});
});
