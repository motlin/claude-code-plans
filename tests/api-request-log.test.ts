import {describe, expect, it} from "vite-plus/test";
import {buildApiRequestLog, resolveApiRequest} from "../src/lib/api-request-log";
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

	it("skips records the strict schema rejects", () => {
		const log = buildApiRequestLog([{...request("bad", "s1"), unexpected: true}]);
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
