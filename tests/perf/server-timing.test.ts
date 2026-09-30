import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {metadata} from "../../src/lib/db/schema";
import {openTestDb, type AppDb} from "../../src/lib/db/connection";

let db: AppDb;

beforeEach(() => {
	db = openTestDb();
});

afterEach(() => {
	db.close();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

const HEADER_PATTERN =
	/^total;dur=(\d+(?:\.\d+)?), db;dur=(\d+(?:\.\d+)?);desc="q=(\d+)", jsonl;desc="b=(\d+);s=(\d+)", proc;desc="n=(\d+)"$/;

function twoQueryHandler(): Response {
	db.index.select().from(metadata).all();
	db.index.select().from(metadata).all();
	return new Response("ok", {headers: {"content-type": "text/html"}});
}

describe("withServerTiming", () => {
	it("sets a Server-Timing header with the request's counters", async () => {
		const {withServerTiming} = await import("../../src/lib/perf/server-timing");
		const response = await withServerTiming(async () => twoQueryHandler())(new Request("http://localhost/x"));

		const match = HEADER_PATTERN.exec(response.headers.get("server-timing") ?? "");
		expect(match?.slice(3)).toStrictEqual(["2", "0", "0", "0"]);
		expect(await response.text()).toBe("ok");
	});

	it("adds the header even when the response headers are immutable", async () => {
		const {withServerTiming} = await import("../../src/lib/perf/server-timing");
		const response = await withServerTiming(() => Response.redirect("http://localhost/y", 302))(
			new Request("http://localhost/x"),
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("http://localhost/y");
		expect(HEADER_PATTERN.test(response.headers.get("server-timing") ?? "")).toBe(true);
	});

	it("leaves event-stream responses untouched", async () => {
		const {withServerTiming} = await import("../../src/lib/perf/server-timing");
		const sse = new Response("data: x\n\n", {headers: {"content-type": "text/event-stream; charset=utf-8"}});
		const response = await withServerTiming(() => sse)(new Request("http://localhost/api/events"));

		expect(response).toBe(sse);
		expect(response.headers.get("server-timing")).toBeNull();
	});

	it("logs one JSON line per request when CCB_PERF_LOG=1", async () => {
		vi.stubEnv("CCB_PERF_LOG", "1");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const {withServerTiming} = await import("../../src/lib/perf/server-timing");
		await withServerTiming(async () => twoQueryHandler())(new Request("http://localhost/x?y=1", {method: "POST"}));

		expect(log).toHaveBeenCalledTimes(1);
		const line = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;
		expect({...line, totalMs: typeof line["totalMs"], sqlMs: typeof line["sqlMs"]}).toStrictEqual({
			perf: "http",
			method: "POST",
			path: "/x",
			status: 200,
			totalMs: "number",
			sqlCount: 2,
			sqlMs: "number",
			jsonlBytesRead: 0,
			jsonlFullScans: 0,
			procSpawned: 0,
		});
	});

	it("does not log when CCB_PERF_LOG is unset", async () => {
		vi.stubEnv("CCB_PERF_LOG", "");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const {withServerTiming} = await import("../../src/lib/perf/server-timing");
		await withServerTiming(async () => twoQueryHandler())(new Request("http://localhost/x"));

		expect(log).not.toHaveBeenCalled();
	});
});
