import {describe, expect, it} from "vite-plus/test";
import {handleHerdrElicitation, type HerdrElicitationDependencies} from "../src/lib/herdr/elicitation";
import type {PendingElicitation} from "../src/lib/domain-event-payload-schemas";
import {rejectCrossSite} from "../src/lib/same-origin-guard";
import {
	URL_ACCEPT_FOCUSED,
	URL_DECLINE_FOCUSED,
	VERDICT_DECLINE_FOCUSED,
	VERDICT_FIELD_FOCUSED,
	VERDICT_PICKED,
	VERDICT_REQUIRED_ERROR,
} from "./fixtures/elicitation-screens";

const verdictSchema = {
	type: "object",
	properties: {verdict: {type: "string", enum: ["allow", "deny", "always_allow"]}},
	required: ["verdict"],
};

const PENDING_VERDICT: PendingElicitation = {
	serverName: "spike-elicit",
	message: "Allow spike-tool to run? (verdict-allow)",
	mode: "form",
	requestedSchema: verdictSchema,
	receivedAt: 1,
};

/** The fixtures each carry their own scenario tag; retag one as the verdict-allow dialog. */
function asVerdictAllow(screen: string, tag: string): string {
	return screen.replace(`(${tag})`, "(verdict-allow)");
}

function postRequest(body: unknown, headers?: HeadersInit): Request {
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request("http://127.0.0.1:7526/api/herdr/elicitation", {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

async function describeResponse(response: Response): Promise<{body: unknown; status: number}> {
	return {body: await response.json(), status: response.status};
}

/** Fake dependencies that log every write, pause and read in order, serving `screens` one read at a time. */
function harness(screens: string[], overrides: Partial<HerdrElicitationDependencies> = {}) {
	const log: string[] = [];
	const remaining = [...screens];
	const dependencies: HerdrElicitationDependencies = {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		pendingElicitation: () => PENDING_VERDICT,
		resolveTarget: async () => Promise.resolve({ok: true, value: {terminalId: "terminal-1", paneId: "w1:p1"}}),
		readScreen: async (sessionId, paneId) => {
			log.push(`pane.read ${sessionId} ${paneId}`);
			const screen = remaining.shift();
			return Promise.resolve(
				screen === undefined
					? {ok: false, code: "no-screen", message: "no screen left"}
					: {ok: true, value: screen},
			);
		},
		request: async (call) => {
			const fields = call as {method: string; params: {keys?: string[]; text?: string}};
			log.push(`${fields.method} ${fields.params.keys?.join(" ") ?? fields.params.text ?? ""}`);
			return Promise.resolve({ok: true, value: {type: "ok"}});
		},
		createRequestId: () => "ccp:elicitation:test",
		pause: async (ms) => {
			log.push(`pause ${ms}`);
			return Promise.resolve();
		},
		...overrides,
	};
	return {log, dependencies};
}

describe("herdr elicitation handler", () => {
	it("allows by picking the verdict option, then re-reads the screen before the guarded final Enter", async () => {
		const {log, dependencies} = harness([VERDICT_FIELD_FOCUSED, VERDICT_PICKED]);
		const response = await handleHerdrElicitation(
			postRequest({sessionId: "session-1", decision: "allow"}),
			dependencies,
		);
		expect({response: await describeResponse(response), log}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			log: [
				"pane.read session-1 w1:p1",
				"agent.send_keys right",
				"pause 80",
				"agent.send_keys enter",
				"pause 200",
				"pane.read session-1 w1:p1",
				"agent.send_keys enter",
			],
		});
	});

	it("always-allows by stepping down to always_allow", async () => {
		const {log, dependencies} = harness([VERDICT_FIELD_FOCUSED, VERDICT_PICKED]);
		const response = await handleHerdrElicitation(
			postRequest({sessionId: "session-1", decision: "always"}),
			dependencies,
		);
		expect({status: response.status, log}).toStrictEqual({
			status: 200,
			log: [
				"pane.read session-1 w1:p1",
				"agent.send_keys right",
				"pause 80",
				"agent.send_keys down",
				"pause 80",
				"agent.send_keys down",
				"pause 80",
				"agent.send_keys enter",
				"pause 200",
				"pane.read session-1 w1:p1",
				"agent.send_keys enter",
			],
		});
	});

	it("denies on the Decline stop, requiring Decline focused before Enter", async () => {
		const {log, dependencies} = harness([
			VERDICT_FIELD_FOCUSED,
			asVerdictAllow(VERDICT_DECLINE_FOCUSED, "verdict-decline-row"),
		]);
		const response = await handleHerdrElicitation(
			postRequest({sessionId: "session-1", decision: "deny"}),
			dependencies,
		);
		expect({status: response.status, log}).toStrictEqual({
			status: 200,
			log: [
				"pane.read session-1 w1:p1",
				"agent.send_keys down",
				"pause 80",
				"agent.send_keys down",
				"pause 200",
				"pane.read session-1 w1:p1",
				"agent.send_keys enter",
			],
		});
	});

	it("cancels with a single Esc and no re-read", async () => {
		const {log, dependencies} = harness([VERDICT_FIELD_FOCUSED]);
		const response = await handleHerdrElicitation(
			postRequest({sessionId: "session-1", decision: "cancel"}),
			dependencies,
		);
		expect({status: response.status, log}).toStrictEqual({
			status: 200,
			log: ["pane.read session-1 w1:p1", "agent.send_keys esc"],
		});
	});

	it("declines a URL elicitation from Accept, re-reading for Decline", async () => {
		const pending: PendingElicitation = {
			serverName: "spike-elicit",
			message: "Open the spike page (url-decline)",
			mode: "url",
			url: "https://example.com/spike",
			receivedAt: 1,
		};
		const {log, dependencies} = harness([URL_ACCEPT_FOCUSED, URL_DECLINE_FOCUSED], {
			pendingElicitation: () => pending,
		});
		const response = await handleHerdrElicitation(
			postRequest({sessionId: "session-1", decision: "deny"}),
			dependencies,
		);
		expect({response: await describeResponse(response), log}).toStrictEqual({
			response: {body: {ok: true}, status: 200},
			log: [
				"pane.read session-1 w1:p1",
				"agent.send_keys right",
				"pause 200",
				"pane.read session-1 w1:p1",
				"agent.send_keys enter",
			],
		});
	});

	it("refuses with zero writes when the screen shows a different elicitation", async () => {
		const {log, dependencies} = harness([VERDICT_FIELD_FOCUSED.replace("(verdict-allow)", "(verdict-other)")]);
		const response = await handleHerdrElicitation(
			postRequest({sessionId: "session-1", decision: "allow"}),
			dependencies,
		);
		expect({response: await describeResponse(response), log}).toStrictEqual({
			response: {body: {error: "The terminal is not showing this elicitation"}, status: 409},
			log: ["pane.read session-1 w1:p1"],
		});
	});

	it("stops before the final Enter when the re-read shows the required-field error", async () => {
		const {log, dependencies} = harness([
			VERDICT_FIELD_FOCUSED,
			asVerdictAllow(VERDICT_REQUIRED_ERROR, "verdict-accept-unset"),
		]);
		const response = await handleHerdrElicitation(
			postRequest({sessionId: "session-1", decision: "allow"}),
			dependencies,
		);
		expect({response: await describeResponse(response), log}).toStrictEqual({
			response: {body: {error: "The terminal dialog did not reach Accept; nothing more was sent"}, status: 409},
			log: [
				"pane.read session-1 w1:p1",
				"agent.send_keys right",
				"pause 80",
				"agent.send_keys enter",
				"pause 200",
				"pane.read session-1 w1:p1",
			],
		});
	});

	it.each([
		{
			name: "writes are disabled",
			overrides: {writesEnabled: () => false},
			decision: "allow",
			response: {body: {error: "herdr writes are disabled"}, status: 403},
		},
		{
			name: "no elicitation is pending",
			overrides: {pendingElicitation: () => null},
			decision: "allow",
			response: {body: {error: "No elicitation is pending"}, status: 409},
		},
		{
			name: "the schema has no always_allow option",
			overrides: {
				pendingElicitation: () => ({
					...PENDING_VERDICT,
					requestedSchema: {type: "object", properties: {verdict: {type: "string", enum: ["allow", "deny"]}}},
				}),
			},
			decision: "always",
			response: {
				body: {error: "The elicitation dialog can't be answered that way from where it stands"},
				status: 409,
			},
		},
		{
			name: "the decision is unknown",
			overrides: {},
			decision: "maybe",
			response: {body: {error: "sessionId and an elicitation decision are required"}, status: 400},
		},
	])("sends nothing when $name", async ({overrides, decision, response}) => {
		const {log, dependencies} = harness([VERDICT_FIELD_FOCUSED], overrides);
		const result = await handleHerdrElicitation(postRequest({sessionId: "session-1", decision}), dependencies);
		expect({
			response: await describeResponse(result),
			writes: log.filter((entry) => !entry.startsWith("pane.read")),
		}).toStrictEqual({response, writes: []});
	});

	it("rejects cross-site requests", async () => {
		const {log, dependencies} = harness([VERDICT_FIELD_FOCUSED]);
		const response = await handleHerdrElicitation(
			postRequest(
				{sessionId: "session-1", decision: "allow"},
				{Origin: "https://attacker.example.com", "Sec-Fetch-Site": "cross-site"},
			),
			dependencies,
		);
		expect({status: response.status, log}).toStrictEqual({status: 403, log: []});
	});
});
