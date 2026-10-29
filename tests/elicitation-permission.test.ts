import {QueryClient} from "@tanstack/react-query";
import {
	PendingElicitationsResponse,
	applyPendingElicitationsChanged,
	pendingElicitationsQueryOptions,
} from "../src/lib/api/pending-elicitations";
import type {PendingElicitation} from "../src/lib/domain-event-payload-schemas";
import {findPendingElicitationPermission, isVerdictSchema} from "../src/lib/permission-card";
import {addPendingElicitation, clearAllPendingElicitations} from "../src/lib/pending-elicitations";
import {handlePendingElicitationsRequest} from "../src/routes/api/sessions.$id.pending-elicitations";
import {elicitationFormFixture, elicitationVerdictFixture} from "./fixtures/elicitation";

afterEach(() => {
	clearAllPendingElicitations();
});

function verdictEntry(verdictEnum: string[], overrides: Partial<PendingElicitation> = {}): PendingElicitation {
	return {
		elicitationId: elicitationVerdictFixture.elicitation_id,
		serverName: elicitationVerdictFixture.mcp_server_name,
		message: elicitationVerdictFixture.message,
		mode: "form",
		requestedSchema: {
			type: "object",
			properties: {verdict: {type: "string", enum: verdictEnum}},
			required: ["verdict"],
		},
		receivedAt: 1_700_000_000_000,
		...overrides,
	};
}

const FORM_ENTRY: PendingElicitation = {
	serverName: elicitationFormFixture.mcp_server_name,
	message: elicitationFormFixture.message,
	mode: "form",
	requestedSchema: elicitationFormFixture.requested_schema,
	receivedAt: 1_700_000_000_000,
};

describe("isVerdictSchema", () => {
	it.each([
		{name: "allow + deny + always_allow", schema: elicitationVerdictFixture.requested_schema, expected: true},
		{
			name: "allow + deny",
			schema: {type: "object", properties: {verdict: {type: "string", enum: ["allow", "deny"]}}},
			expected: true,
		},
		{
			name: "no deny",
			schema: {type: "object", properties: {verdict: {type: "string", enum: ["allow", "always_allow"]}}},
			expected: false,
		},
		{name: "a form", schema: elicitationFormFixture.requested_schema, expected: false},
		{
			name: "verdict without an enum",
			schema: {type: "object", properties: {verdict: {type: "string"}}},
			expected: false,
		},
		{name: "no schema", schema: undefined, expected: false},
	])("$name → $expected", ({schema, expected}) => {
		expect(isVerdictSchema(schema)).toStrictEqual(expected);
	});
});

describe("findPendingElicitationPermission", () => {
	it("draws a verdict elicitation as upstream's 'use {server}' permission card, with Always allow when offered", () => {
		expect(findPendingElicitationPermission([verdictEntry(["allow", "deny", "always_allow"])])).toStrictEqual({
			notificationId: "elicitation:elicit-verdict-1",
			title: {action: "use my-mcp-server", meta: null},
			detail: null,
			description: "Allow my-mcp-server to delete the deploy branch?",
			persistentAllow: "always",
		});
	});

	it("offers only Deny / Allow once when the enum has no always_allow", () => {
		expect(findPendingElicitationPermission([verdictEntry(["allow", "deny"])])).toStrictEqual({
			notificationId: "elicitation:elicit-verdict-1",
			title: {action: "use my-mcp-server", meta: null},
			detail: null,
			description: "Allow my-mcp-server to delete the deploy branch?",
		});
	});

	it("keys an elicitation without an id by its server and arrival", () => {
		const {elicitationId: _, ...withoutId} = verdictEntry(["allow", "deny"]);
		expect(findPendingElicitationPermission([withoutId])?.notificationId).toStrictEqual(
			"elicitation:my-mcp-server:1700000000000",
		);
	});

	it.each([
		{name: "a form schema", entries: [FORM_ENTRY]},
		{name: "an enum without deny", entries: [verdictEntry(["allow", "always_allow"])]},
		{name: "a url elicitation", entries: [{...verdictEntry(["allow", "deny"]), mode: "url" as const}]},
		{name: "nothing pending", entries: []},
	])("is null for $name", ({entries}) => {
		expect(findPendingElicitationPermission(entries)).toStrictEqual(null);
	});

	it("picks the oldest verdict elicitation past a form one", () => {
		expect(
			findPendingElicitationPermission([FORM_ENTRY, verdictEntry(["allow", "deny"])])?.notificationId,
		).toStrictEqual("elicitation:elicit-verdict-1");
	});
});

describe("GET /api/sessions/$id/pending-elicitations", () => {
	it("returns the session's pending elicitations, or none for a session without one", async () => {
		addPendingElicitation("session-alice", FORM_ENTRY);

		const bodies = await Promise.all(
			["session-alice", "session-bob"].map(async (sessionId) =>
				PendingElicitationsResponse.parse(await handlePendingElicitationsRequest(sessionId).json()),
			),
		);

		expect(bodies).toStrictEqual([{pendingElicitations: [FORM_ENTRY]}, {pendingElicitations: []}]);
	});
});

describe("applyPendingElicitationsChanged", () => {
	it("patches the session's cached elicitations from the SSE payload", () => {
		const queryClient = new QueryClient();
		const key = pendingElicitationsQueryOptions("session-alice").queryKey;

		applyPendingElicitationsChanged(queryClient, {sessionId: "session-alice", pendingElicitations: [FORM_ENTRY]});
		const added = queryClient.getQueryData(key);
		applyPendingElicitationsChanged(queryClient, {sessionId: "session-alice", pendingElicitations: []});
		const resolved = queryClient.getQueryData(key);

		expect({added, resolved}).toStrictEqual({
			added: {pendingElicitations: [FORM_ENTRY]},
			resolved: {pendingElicitations: []},
		});
	});
});
