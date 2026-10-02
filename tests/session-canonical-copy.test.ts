// @vitest-environment jsdom
import {QueryClient} from "@tanstack/react-query";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {getCachedCanonicalSessionRouteId} from "../src/lib/api/session-identity";
import {sessionQueryKeys} from "../src/lib/api/sessions";
import {copySessionLink, sessionResumeCommand, sessionUrl} from "../src/lib/session-open-in";

const ALICE = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";
const ALIAS = "session_alice_100";
let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	client = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	client.clear();
	vi.unstubAllGlobals();
});

function seedProof() {
	// Cache-policy tests require only fields read by the synchronous helper; no detail UI mounts.
	client.setQueryData(sessionQueryKeys.detail(ALICE), {canonicalRouteId: ALIAS});
}
function assertProof(expected: string) {
	const before = client
		.getQueryCache()
		.getAll()
		.map((query) => ({key: query.queryKey, state: query.state}));
	const events = vi.fn();
	const unsubscribe = client.getQueryCache().subscribe(events);
	const routeId = getCachedCanonicalSessionRouteId(client, ALICE);
	unsubscribe();
	expect({
		routeId,
		cache: client
			.getQueryCache()
			.getAll()
			.map((query) => ({key: query.queryKey, state: query.state})),
		events: events.mock.calls,
		requests: fetchMock.mock.calls,
	}).toStrictEqual({routeId: expected, cache: before, events: [], requests: []});
}

describe("fresh canonical route proof", () => {
	it("uses UUID without any detail query or a network request", () => assertProof(ALICE));
	it.each([null, {}, {canonicalRoutePending: true}, {canonicalRouteId: ALIAS, canonicalRoutePending: true}])(
		"rejects detail without a completed canonical proof: %j",
		(data) => {
			client.setQueryData(sessionQueryKeys.detail(ALICE), data);
			assertProof(ALICE);
		},
	);
	it("accepts a fresh detail proof without creating an identity query", () => {
		seedProof();
		assertProof(ALIAS);
	});
	it.each([
		{status: "pending" as const},
		{status: "error" as const, error: new Error("Example detail failure")},
		{isInvalidated: true},
		{fetchStatus: "fetching" as const},
		{fetchStatus: "paused" as const},
	])("rejects unsettled or invalid detail even if it retains data: %j", (state) => {
		seedProof();
		client
			.getQueryCache()
			.find({queryKey: sessionQueryKeys.detail(ALICE), exact: true})!
			.setState(state);
		assertProof(ALICE);
	});
	it("rejects a first pending identity query without data", () => {
		seedProof();
		client.getQueryCache().build(client, {queryKey: sessionQueryKeys.identity(ALIAS)});
		assertProof(ALICE);
	});
	it.each([
		{label: "matching owner", owner: ALICE, state: {}, expected: ALIAS},
		{label: "different owner", owner: BOB, state: {}, expected: ALICE},
		{label: "invalidated", owner: ALICE, state: {isInvalidated: true}, expected: ALICE},
		{label: "pending", owner: ALICE, state: {status: "pending" as const}, expected: ALICE},
		{
			label: "failed with stale data",
			owner: ALICE,
			state: {status: "error" as const, error: new Error("Example ambiguity")},
			expected: ALICE,
		},
		{label: "fetching", owner: ALICE, state: {fetchStatus: "fetching" as const}, expected: ALICE},
		{label: "paused", owner: ALICE, state: {fetchStatus: "paused" as const}, expected: ALICE},
	])("respects an existing $label identity", ({owner, state, expected}) => {
		seedProof();
		client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: owner});
		client
			.getQueryCache()
			.find({queryKey: sessionQueryKeys.identity(ALIAS), exact: true})!
			.setState(state);
		assertProof(expected);
	});
	it("rechecks current ownership on each call instead of holding the old proof", () => {
		seedProof();
		const before = getCachedCanonicalSessionRouteId(client, ALICE);
		client.setQueryData(sessionQueryKeys.identity(ALIAS), {sessionId: BOB});
		const after = getCachedCanonicalSessionRouteId(client, ALICE);
		expect([before, after]).toStrictEqual([ALIAS, ALICE]);
		assertProof(ALICE);
	});
});

describe("copied local session URL", () => {
	it("copies the alias synchronously in the gesture, falling back after invalidation, while CLI and new-tab URLs stay UUID", async () => {
		seedProof();
		const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", {clipboard: {writeText}});
		const toast = vi.fn();
		const copy = copySessionLink(ALICE, toast, client);
		// Before awaiting: no network or pre-clipboard await was introduced.
		expect({writes: writeText.mock.calls, requests: fetchMock.mock.calls}).toStrictEqual({
			writes: [[`${window.location.origin}/session/${ALIAS}`]],
			requests: [],
		});
		await copy;
		await client.invalidateQueries({queryKey: sessionQueryKeys.detail(ALICE), refetchType: "none"});
		await copySessionLink(ALICE, toast, client);
		expect({
			writes: writeText.mock.calls,
			toasts: toast.mock.calls,
			newTab: sessionUrl(ALICE),
			resume: sessionResumeCommand(ALICE, "/Users/alice/example-project"),
			requests: fetchMock.mock.calls,
		}).toStrictEqual({
			writes: [[`${window.location.origin}/session/${ALIAS}`], [`${window.location.origin}/session/${ALICE}`]],
			toasts: [
				[{kind: "success", message: "Link copied to clipboard."}],
				[{kind: "success", message: "Link copied to clipboard."}],
			],
			newTab: `${window.location.origin}/session/${ALICE}`,
			resume: `cd '/Users/alice/example-project' && claude -r ${ALICE}`,
			requests: [],
		});
	});
});
