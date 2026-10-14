import {describe, expect, it, vi} from "vite-plus/test";
import {handleHerdrQuestion, questionAnswerSteps, type HerdrQuestionDependencies} from "../src/lib/herdr/question";
import type {HerdrRequester} from "../src/lib/herdr/panes";
import type {PendingQuestion, PendingQuestionItem, QuestionAnswer} from "../src/lib/hook-events";
import {rejectCrossSite} from "../src/lib/same-origin-guard";

const COLOR: PendingQuestionItem = {
	question: "Pick a color?",
	header: "Color",
	multiSelect: false,
	options: [{label: "Red"}, {label: "Blue"}],
};

const TOPPINGS: PendingQuestionItem = {
	question: "Pick toppings?",
	header: "Toppings",
	multiSelect: true,
	options: [{label: "Cheese"}, {label: "Ham"}, {label: "Olive"}],
};

describe("questionAnswerSteps", () => {
	// Each sequence was replayed against the CLI's AskUserQuestion dialog (v2.1.299) in a throwaway session.
	it.each<{name: string; questions: PendingQuestionItem[]; answers: Array<QuestionAnswer | null>; steps: unknown}>([
		{
			name: "a lone single-select option submits on its digit",
			questions: [COLOR],
			answers: [{selected: [1]}],
			steps: [{key: "2"}],
		},
		{
			name: "a lone single-select Other picks the Type something row, types and submits with Enter",
			questions: [COLOR],
			answers: [{selected: [], other: "Green"}],
			steps: [{key: "3"}, {text: "Green"}, {key: "enter"}],
		},
		{
			name: "a skipped lone single-select question cancels the dialog, which has no review page",
			questions: [COLOR],
			answers: [null],
			steps: [{key: "esc"}],
		},
		{
			name: "a lone multi-select toggles digits, walks to Submit and confirms the review",
			questions: [TOPPINGS],
			answers: [{selected: [0, 2]}],
			steps: [
				{key: "1"},
				{key: "3"},
				{key: "down"},
				{key: "down"},
				{key: "down"},
				{key: "down"},
				{key: "enter"},
				{key: "1"},
			],
		},
		{
			name: "several questions: digit advances, Other is typed on its row, then the review is confirmed",
			questions: [COLOR, TOPPINGS],
			answers: [{selected: [1]}, {selected: [0, 2], other: "Pepper"}],
			steps: [
				{key: "2"},
				{key: "1"},
				{key: "3"},
				{key: "down"},
				{key: "down"},
				{key: "down"},
				{text: "Pepper"},
				{key: "down"},
				{key: "enter"},
				{key: "1"},
			],
		},
		{
			name: "skipped questions among several: Tab past a single-select, walk past an empty multi-select",
			questions: [TOPPINGS, COLOR],
			answers: [null, null],
			steps: [
				{key: "down"},
				{key: "down"},
				{key: "down"},
				{key: "down"},
				{key: "enter"},
				{key: "tab"},
				{key: "1"},
			],
		},
		{
			name: "Other text is flattened to one line so its newlines cannot press Enter",
			questions: [COLOR, COLOR],
			answers: [{selected: [], other: "  Line one\n\nline two\t "}, {selected: [0]}],
			steps: [{key: "3"}, {text: "Line one line two"}, {key: "enter"}, {key: "1"}, {key: "1"}],
		},
		{
			name: "blank Other text counts as a skip",
			questions: [COLOR, COLOR],
			answers: [{selected: [], other: "   "}, {selected: [0]}],
			steps: [{key: "tab"}, {key: "1"}, {key: "1"}],
		},
	])("$name", ({questions, answers, steps}) => {
		expect(questionAnswerSteps(questions, answers)).toStrictEqual(steps);
	});

	it.each<{name: string; questions: PendingQuestionItem[]; answers: Array<QuestionAnswer | null>}>([
		{name: "a missing answer", questions: [COLOR, COLOR], answers: [{selected: [0]}]},
		{name: "an option past the last", questions: [COLOR], answers: [{selected: [2]}]},
		{name: "a negative option", questions: [COLOR], answers: [{selected: [-1]}]},
		{name: "two options on a single-select", questions: [COLOR], answers: [{selected: [0, 1]}]},
		{name: "an option and Other on a single-select", questions: [COLOR], answers: [{selected: [0], other: "x"}]},
		{name: "a repeated multi-select option", questions: [TOPPINGS], answers: [{selected: [0, 0]}]},
	])("refuses $name", ({questions, answers}) => {
		expect(questionAnswerSteps(questions, answers)).toBeNull();
	});
});

function request(body: unknown, headers?: HeadersInit): Request {
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request("http://127.0.0.1:7526/api/herdr/question", {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

async function describeResponse(response: Response): Promise<{body: unknown; status: number}> {
	return {body: await response.json(), status: response.status};
}

const PENDING: PendingQuestion = {toolUseId: "toolu_test_100", questions: [COLOR, TOPPINGS]};

function dependencies(overrides: Partial<HerdrQuestionDependencies> = {}): HerdrQuestionDependencies {
	return {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		pendingQuestion: () => PENDING,
		resolveTarget: async () =>
			Promise.resolve({
				ok: true,
				value: {terminalId: "terminal-test-100", paneId: "w100:p100"},
			}),
		request: async () => Promise.resolve({ok: true, value: {type: "ok"}}),
		createRequestId: () => "ccp:question:test-100",
		pause: async () => Promise.resolve(),
		...overrides,
	};
}

const VALID_BODY = {
	sessionId: "session-test-100",
	toolUseId: "toolu_test_100",
	answers: [{selected: [1]}, {selected: [], other: "Pepper"}],
};

describe("herdr question answer handler", () => {
	it("returns before resolving when writes are disabled", async () => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrQuestion(
			request(VALID_BODY),
			dependencies({writesEnabled: () => false, request: sendRequest}),
		);
		expect({response: await describeResponse(response), calls: sendRequest.mock.calls}).toStrictEqual({
			response: {body: {error: "herdr writes are disabled"}, status: 403},
			calls: [],
		});
	});

	it("rejects cross-site requests", async () => {
		const response = await handleHerdrQuestion(
			request(VALID_BODY, {Origin: "https://attacker.example.com", "Sec-Fetch-Site": "cross-site"}),
			dependencies(),
		);
		expect(response.status).toStrictEqual(403);
	});

	it.each([
		{body: {sessionId: "session-test-100", toolUseId: "toolu_test_100"}, name: "missing answers"},
		{body: {...VALID_BODY, sessionId: ""}, name: "an empty session id"},
		{body: {...VALID_BODY, keys: ["ctrl+c"]}, name: "caller-supplied keys"},
		{body: {...VALID_BODY, answers: [{selected: ["1"]}, null]}, name: "a non-numeric option"},
	])("returns 400 for $name", async ({body}) => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrQuestion(request(body), dependencies({request: sendRequest}));
		expect({response: await describeResponse(response), calls: sendRequest.mock.calls}).toStrictEqual({
			response: {body: {error: "sessionId, toolUseId and one answer per question are required"}, status: 400},
			calls: [],
		});
	});

	it.each([
		{name: "no question is pending", pending: null},
		{name: "a different question is pending", pending: {...PENDING, toolUseId: "toolu_test_200"}},
	])("refuses to type into the pane when $name", async ({pending}) => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrQuestion(
			request(VALID_BODY),
			dependencies({pendingQuestion: () => pending, request: sendRequest}),
		);
		expect({response: await describeResponse(response), calls: sendRequest.mock.calls}).toStrictEqual({
			response: {body: {error: "That question is no longer pending"}, status: 409},
			calls: [],
		});
	});

	it("returns 400 when the answers do not fit the pending question", async () => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrQuestion(
			request({...VALID_BODY, answers: [{selected: [5]}, null]}),
			dependencies({request: sendRequest}),
		);
		expect({response: await describeResponse(response), calls: sendRequest.mock.calls}).toStrictEqual({
			response: {body: {error: "The answers do not fit the pending question"}, status: 400},
			calls: [],
		});
	});

	it("types the answer into the session's pane one step at a time, pausing between steps", async () => {
		const events: unknown[] = [];
		const response = await handleHerdrQuestion(
			request(VALID_BODY),
			dependencies({
				request: async (value) => {
					events.push(value);
					return Promise.resolve({ok: true, value: {type: "ok"}});
				},
				pause: async () => {
					events.push("pause");
					return Promise.resolve();
				},
			}),
		);
		const keys = (key: string) => ({
			id: "ccp:question:test-100",
			method: "agent.send_keys",
			params: {target: "w100:p100", keys: [key]},
		});
		expect({response: await describeResponse(response), events}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			events: [
				keys("2"),
				"pause",
				keys("down"),
				"pause",
				keys("down"),
				"pause",
				keys("down"),
				"pause",
				{id: "ccp:question:test-100", method: "pane.send_text", params: {pane_id: "w100:p100", text: "Pepper"}},
				"pause",
				keys("down"),
				"pause",
				keys("enter"),
				"pause",
				keys("1"),
			],
		});
	});

	it("stops at the first step herdr rejects", async () => {
		const sendRequest = vi.fn<HerdrRequester>(async () =>
			Promise.resolve({ok: false, code: "pane_not_found", message: "Fabricated"}),
		);
		const response = await handleHerdrQuestion(request(VALID_BODY), dependencies({request: sendRequest}));
		expect({response: await describeResponse(response), calls: sendRequest.mock.calls.length}).toStrictEqual({
			response: {body: {error: "Fabricated"}, status: 502},
			calls: 1,
		});
	});

	it("reports an unresolvable pane without typing", async () => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrQuestion(
			request(VALID_BODY),
			dependencies({
				resolveTarget: async () =>
					Promise.resolve({ok: false, code: "session-not-found", message: "Fabricated not found"}),
				request: sendRequest,
			}),
		);
		expect({response: await describeResponse(response), calls: sendRequest.mock.calls}).toStrictEqual({
			response: {body: {error: "Fabricated not found"}, status: 502},
			calls: [],
		});
	});
});
