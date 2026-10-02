// V8 call-count harness for one pure hot path (measurement plan §2.4 L5, §4.2).
//
//   node --predictable --expose-gc --max-opt=0 --no-lazy-feedback-allocation --no-flush-bytecode \
//     tests/perf/run-hot-path.mjs <fn> <shape>
//
// Loads the scenario through tsx, warms the function up once, then counts every call into src/** during one more run
// with V8 precise coverage and prints {fn, shape, calls} as the last line of stdout. It runs as its own process so the
// test runner's instrumentation is not counted. HOT_PATH_NODE_FLAGS in tests/perf/perf-ids.ts explains the V8 flags;
// without them the counts are neither exact nor repeatable.
import {Session} from "node:inspector";
import {join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {register} from "tsx/esm/api";

const [fn, shape] = process.argv.slice(2);
if (fn === undefined || shape === undefined) {
	console.error("usage: run-hot-path.mjs <fn> <shape>");
	process.exit(2);
}

const SRC_URL = pathToFileURL(join(fileURLToPath(new URL("../..", import.meta.url)), "src")).href + "/";

register();
const {prepareHotPath} = await import("./hot-path-scenarios.ts");
const run = await prepareHotPath(fn, shape);
run();

const session = new Session();
session.connect();

/** Posts synchronously: an in-thread inspector session answers before `post` returns. */
function post(method, params) {
	let response;
	session.post(method, params, (error, result) => {
		if (error) throw error;
		response = result;
	});
	if (response === undefined) throw new Error(`${method} did not answer synchronously`);
	return response;
}

post("Profiler.enable");
post("Profiler.startPreciseCoverage", {callCount: true, detailed: true});
// Taking coverage resets the counters, so the count below holds the measured run alone.
post("Profiler.takePreciseCoverage");
run();
const {result} = post("Profiler.takePreciseCoverage");
post("Profiler.stopPreciseCoverage");
session.disconnect();

let calls = 0;
for (const script of result) {
	if (!script.url.startsWith(SRC_URL)) continue;
	for (const fnCoverage of script.functions) calls += fnCoverage.ranges[0]?.count ?? 0;
}

process.stdout.write(`${JSON.stringify({fn, shape, calls})}\n`);
process.exit(0);
