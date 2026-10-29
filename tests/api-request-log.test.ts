import {describe, expect, it} from "vite-plus/test";
import {resolveApiRequest} from "../src/lib/api-request-log";
import {buildApiRequestLog} from "../src/lib/api-request-log-builder";
import {jsonlRecordFixtures} from "./fixtures/jsonl-records";

const baseRequest = jsonlRecordFixtures["api-request"];
const baseShape = jsonlRecordFixtures["api-request-shape"];

function request(id: string, shapeHash: string, overrides: {querySource?: string; effort?: string} = {}) {
	return {
		...baseRequest,
		id,
		shapeHash,
		querySource: overrides.querySource ?? baseRequest.querySource,
		params: {...baseRequest.params, output_config: {effort: overrides.effort ?? "medium"}},
	};
}

function shape(shapeHash: string, tools: string[], system: string[] = ["You are a test."]) {
	return {
		...baseShape,
		shapeHash,
		shape: {
			system: system.map((text) => ({type: "text" as const, text})),
			tools: tools.map((name) => ({name, input_schema: {}})),
		},
	};
}

describe("buildApiRequestLog", () => {
	it("is empty for a session with no api-request records", () => {
		const log = buildApiRequestLog([
			{type: "user", message: {role: "user", content: "hi"}},
			jsonlRecordFixtures["api-request-blob"],
		]);
		expect(log).toStrictEqual({requests: {}, shapes: {}});
	});

	it("summarizes each request's params and each shape's system prompt and tool names", () => {
		const log = buildApiRequestLog([shape("s1", ["Read", "Bash"]), request("r1", "s1")]);
		expect(log).toStrictEqual({
			requests: {
				r1: {
					id: "r1",
					timestamp: "2000-01-01T00:00:00.000Z",
					querySource: "repl_main_thread",
					shapeHash: "s1",
					model: "test-model",
					betas: ["test-beta"],
					maxTokens: 100,
					thinking: {type: "adaptive", display: "updates"},
					effort: "medium",
					permissionMode: "auto",
				},
			},
			shapes: {s1: {shapeHash: "s1", system: ["You are a test."], tools: ["Read", "Bash"]}},
		});
	});

	it("diffs the tools of a request whose shape differs from its query source's previous request", () => {
		const log = buildApiRequestLog([
			shape("s1", ["Read", "Bash"]),
			request("r1", "s1"),
			request("r2", "s1"),
			request("sub1", "s9", {querySource: "agent:custom"}),
			shape("s2", ["Read", "Write"]),
			request("r3", "s2"),
		]);
		expect(log.requests["r1"]?.toolChanges).toBeUndefined();
		expect(log.requests["r2"]?.toolChanges).toBeUndefined();
		expect(log.requests["sub1"]?.toolChanges).toBeUndefined();
		expect(log.requests["r3"]?.toolChanges).toStrictEqual({added: ["Write"], removed: ["Bash"]});
	});

	it("summarizes the classifier's artifact share state, local paths and last publish", () => {
		const [safeguard] = baseRequest.params.safeguards;
		const classifierContext = safeguard!.classifier_context;
		const record = {
			...request("r1", "s1"),
			params: {
				...request("r1", "s1").params,
				safeguards: [
					{
						...safeguard!,
						classifier_context: {
							...classifierContext,
							artifacts: {
								...classifierContext.artifacts,
								by_slug: {
									"artifact-alice-1": {
										share: {
											mode: "owner",
											is_shared_live: true,
											role: "owner",
											probed: true,
											probe_current_account: true,
											type_lock: true,
											live_paths: ["index.html"],
											capabilities: {db: {}, user: {scopes: ["profile"]}},
											grant_observed: true,
										},
									},
									"artifact-alice-2": {
										share: {
											mode: "owner",
											is_shared_live: false,
											probe_failed: true,
											probed: true,
											probe_current_account: false,
											live_paths: [],
											grant_observed: false,
										},
										published_env: "prod",
									},
									"artifact-alice-3": {attested: "first_party_type"},
								},
								by_path: {
									"/tmp/alice/review.html": {slug: "artifact-alice-2"},
									"/tmp/alice/other.html": {slug: "artifact-alice-4"},
								},
								last_publish: {slug: "artifact-alice-2", env: "prod"},
							},
						},
					},
				],
			},
		};
		const log = buildApiRequestLog([record]);
		expect(log.requests["r1"]?.artifacts).toStrictEqual([
			{
				id: "artifact-alice-1",
				paths: [],
				lastPublish: false,
				share: {
					mode: "owner",
					role: "owner",
					isSharedLive: true,
					probed: true,
					probeFailed: false,
					probeCurrentAccount: true,
					typeLock: true,
					livePaths: ["index.html"],
					capabilities: ["db", "user"],
					grantObserved: true,
				},
			},
			{
				id: "artifact-alice-2",
				paths: ["/tmp/alice/review.html"],
				lastPublish: true,
				publishedEnv: "prod",
				share: {
					mode: "owner",
					isSharedLive: false,
					probed: true,
					probeFailed: true,
					probeCurrentAccount: false,
					typeLock: false,
					livePaths: [],
					capabilities: [],
					grantObserved: false,
				},
			},
			{id: "artifact-alice-3", paths: [], lastPublish: false, attested: "first_party_type"},
			{id: "artifact-alice-4", paths: ["/tmp/alice/other.html"], lastPublish: false},
		]);
	});

	it("omits artifacts when the classifier saw none", () => {
		const log = buildApiRequestLog([request("r1", "s1")]);
		expect(log.requests["r1"]?.artifacts).toBeUndefined();
	});

	it("keeps a record carrying keys newer than the schema", () => {
		const log = buildApiRequestLog([{...request("newer", "s1"), unexpected: true}]);
		expect(log).toStrictEqual(buildApiRequestLog([request("newer", "s1")]));
		expect(Object.keys(log.requests)).toStrictEqual(["newer"]);
	});

	it("skips records the schema rejects", () => {
		const log = buildApiRequestLog([{...request("bad", "s1"), shapeHash: 5}]);
		expect(log).toStrictEqual({requests: {}, shapes: {}});
	});
});

describe("resolveApiRequest", () => {
	const log = buildApiRequestLog([shape("s1", ["Read"]), request("r1", "s1"), request("r2", "missing")]);

	it("resolves a requestRef to its request and the shape it was sent with", () => {
		expect(resolveApiRequest(log, "r1")).toStrictEqual({
			request: log.requests["r1"],
			shape: {shapeHash: "s1", system: ["You are a test."], tools: ["Read"]},
		});
	});

	it("resolves a request whose shape record is absent without a shape", () => {
		expect(resolveApiRequest(log, "r2")).toStrictEqual({request: log.requests["r2"], shape: null});
	});

	it("is null for a requestRef with no matching api-request", () => {
		expect(resolveApiRequest(log, "nope")).toBeNull();
	});
});
