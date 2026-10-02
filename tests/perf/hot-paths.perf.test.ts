import {describe, expect, it} from "vite-plus/test";
import {execFile} from "node:child_process";
import {join} from "node:path";
import {promisify} from "node:util";
import {perfShapes} from "./fixtures/generate-transcript";
import {
	HOT_PATH_FIXED_SHAPES,
	HOT_PATH_NODE_FLAGS,
	HOT_PATH_SHAPED_FNS,
	hotPathId,
	type HotPathFixedFn,
	type HotPathFn,
} from "./perf-ids";
import {ratchet} from "./ratchet";

/**
 * Lab call counts for the pure hot paths (measurement plan §2.4 L5, §4.2). Each measurement runs in its own
 * `node --predictable` child so vitest's instrumentation is not counted; the child reports the V8 precise-coverage call
 * count into `src/**` for one run of the function after a warm-up.
 */

const HARNESS = join(__dirname, "run-hot-path.mjs");

const TIMEOUT = 600_000;

async function measureCalls(fn: HotPathFn, shape: string): Promise<number> {
	const {stdout} = await promisify(execFile)(process.execPath, [...HOT_PATH_NODE_FLAGS, HARNESS, fn, shape], {
		maxBuffer: 16 * 1024 * 1024,
	});
	const lines = stdout.trim().split("\n");
	const result = JSON.parse(lines[lines.length - 1]!) as {fn: string; shape: string; calls: number};
	expect({fn: result.fn, shape: result.shape}).toStrictEqual({fn, shape});
	return result.calls;
}

describe("hot path call counts", () => {
	it(
		"gives identical counts when the harness runs twice on the same input",
		async () => {
			const [first, second] = await Promise.all([
				measureCalls("processTranscript", "small"),
				measureCalls("processTranscript", "small"),
			]);
			expect(first).toBeGreaterThan(0);
			expect(second).toBe(first);
		},
		TIMEOUT,
	);

	for (const shape of perfShapes()) {
		for (const fn of HOT_PATH_SHAPED_FNS) {
			it(
				`${fn} ${shape.name}`,
				async () => ratchet(hotPathId(fn, shape.name), await measureCalls(fn, shape.name)),
				TIMEOUT,
			);
		}
	}

	for (const [fn, shape] of Object.entries(HOT_PATH_FIXED_SHAPES) as [HotPathFixedFn, string][]) {
		it(`${fn} ${shape}`, async () => ratchet(hotPathId(fn, shape), await measureCalls(fn, shape)), TIMEOUT);
	}
});
