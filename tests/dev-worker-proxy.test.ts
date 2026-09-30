import {once} from "node:events";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {Worker} from "node:worker_threads";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {closeWorkerConnection, devRequestErrorHandler, devWorkerProxy} from "../src/lib/dev-worker-proxy";

// Stands in for the env-runner worker that serves the nitro app in dev: an HTTP server on an ephemeral loopback
// port whose event loop can be stalled on demand. The real worker expires idle sockets after 5s plus Node's 1s
// buffer; 2s with no buffer keeps the race identical (the agent drops sockets 1s before the hinted timeout).
const WORKER_SOURCE = `
const {createServer} = require("node:http");
const {parentPort} = require("node:worker_threads");
const server = createServer((_req, res) => res.end("ok"));
server.keepAliveTimeout = 2000;
server.keepAliveTimeoutBuffer = 0;
server.listen(0, "127.0.0.1", () => parentPort.postMessage({port: server.address().port}));
parentPort.on("message", (ms) => {
	const until = Date.now() + ms;
	while (Date.now() < until) {}
	parentPort.postMessage("unblocked");
});
`;

// Nitro's own dev transport: srvx wraps the node request and env-runner forwards it with httpxy. Load the copies
// nitro resolves, so the test exercises exactly what the dev server runs.
const nitroRequire = createRequire(createRequire(import.meta.url).resolve("nitro/vite"));
const envRunnerRequire = createRequire(nitroRequire.resolve("env-runner"));
const {proxyFetch} = (await import(pathToFileURL(envRunnerRequire.resolve("httpxy")).href)) as {
	proxyFetch: (addr: string, input: Request) => Promise<Response>;
};
const {NodeRequest, sendNodeResponse} = (await import(pathToFileURL(nitroRequire.resolve("srvx/node")).href)) as {
	NodeRequest: new (context: {req: IncomingMessage; res: ServerResponse}) => Request;
	sendNodeResponse: (res: ServerResponse, response: Response) => Promise<void>;
};

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startWorker(): Promise<{worker: Worker; port: number}> {
	const worker = new Worker(WORKER_SOURCE, {eval: true});
	cleanups.push(() => worker.terminate());
	const [message] = (await once(worker, "message")) as [{port: number}];
	return {worker, port: message.port};
}

// Mirrors nitro's dev middleware: wrap the node request and proxy it to the worker with httpxy.
async function startFront(workerPort: number, middlewares: Middleware[]): Promise<{url: string; errors: unknown[]}> {
	const errors: unknown[] = [];
	const server: Server = createServer((req, res) => {
		const forward = async () => {
			try {
				const upstream = await proxyFetch(`http://127.0.0.1:${workerPort}`, new NodeRequest({req, res}));
				await sendNodeResponse(res, upstream);
			} catch (error) {
				errors.push(error);
				res.statusCode = 500;
				res.end();
			}
		};
		const run = (index: number): void => {
			const middleware = middlewares[index];
			if (middleware === undefined) {
				void forward();
				return;
			}
			middleware(req, res, () => run(index + 1));
		};
		run(0);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	cleanups.push(() => new Promise((resolve) => server.close(resolve)));
	return {url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, errors};
}

function pluginNames(option: unknown): string[] {
	if (Array.isArray(option)) {
		return option.flatMap((entry: unknown) => pluginNames(entry));
	}
	return option !== null && typeof option === "object" && "name" in option && typeof option.name === "string"
		? [option.name]
		: [];
}

async function requestWhileWorkerStalls(middlewares: Middleware[]): Promise<{statuses: number[]; errors: string[]}> {
	const {worker, port} = await startWorker();
	const front = await startFront(port, middlewares);
	const first = await fetch(front.url);
	await first.text();
	const unblocked = once(worker, "message");
	worker.postMessage(2300);
	await new Promise((resolve) => setTimeout(resolve, 50));
	const second = await fetch(front.url);
	await second.text();
	await unblocked;
	return {
		statuses: [first.status, second.status],
		errors: front.errors.map((error) => (error as NodeJS.ErrnoException).code ?? String(error)),
	};
}

describe("dev worker proxy", () => {
	it("reproduces the stale keep-alive reset when the worker's event loop stalls", async () => {
		expect(await requestWhileWorkerStalls([])).toEqual({statuses: [200, 500], errors: ["ECONNRESET"]});
	});

	it("does not reuse worker connections, so a stalled worker delays requests instead of resetting them", async () => {
		expect(await requestWhileWorkerStalls([closeWorkerConnection])).toEqual({statuses: [200, 200], errors: []});
	});

	it("marks the forwarded request close whether or not the browser sent a Connection header", () => {
		const withHeader = {headers: {connection: "keep-alive"}, rawHeaders: ["Host", "x", "Connection", "keep-alive"]};
		const withoutHeader = {headers: {}, rawHeaders: ["Host", "x"]};
		const next = () => {};

		closeWorkerConnection(withHeader, {}, next);
		closeWorkerConnection(withoutHeader, {}, next);

		expect([withHeader, withoutHeader]).toEqual([
			{headers: {connection: "close"}, rawHeaders: ["Host", "x", "Connection", "close"]},
			{headers: {connection: "close"}, rawHeaders: ["Host", "x", "Connection", "close"]},
		]);
	});

	it("is wired into the dev server config after nitro", async () => {
		const {default: config} = await import("../vite.config");
		const names = pluginNames(config.plugins);

		expect(names.slice(-2)).toEqual(["ccp:dev-worker-connection-close", "ccp:dev-request-errors"]);
		expect(names.indexOf("ccp:dev-request-errors")).toBeGreaterThan(
			names.findIndex((name) => name.startsWith("nitro")),
		);
	});

	it("swallows disconnect errors once the browser has gone away", () => {
		const forwarded: unknown[] = [];
		const error = Object.assign(new Error("read ECONNRESET"), {code: "ECONNRESET"});

		devRequestErrorHandler(
			error,
			{method: "GET", url: "/api/events", socket: {destroyed: true}},
			{destroyed: true},
			(err) => forwarded.push(err),
		);

		expect(forwarded).toEqual([]);
	});

	it("still reports genuine failures, naming the route", () => {
		const forwarded: unknown[] = [];
		const reset = Object.assign(new Error("read ECONNRESET"), {code: "ECONNRESET"});
		const broken = new Error("handler exploded");

		devRequestErrorHandler(
			reset,
			{method: "GET", url: "/api/sessions", socket: {destroyed: false}},
			{destroyed: false},
			(err) => forwarded.push(err),
		);
		devRequestErrorHandler(
			broken,
			{method: "POST", url: "/api/chat", socket: {destroyed: true}},
			{destroyed: true},
			(err) => forwarded.push(err),
		);

		expect(forwarded.map((err) => (err as Error).message)).toEqual([
			"read ECONNRESET (GET /api/sessions)",
			"handler exploded (POST /api/chat)",
		]);
		expect(forwarded).toEqual([reset, broken]);
	});

	it("registers the connection middleware before nitro and the error handler after it", () => {
		const registered: string[] = [];
		const server = {middlewares: {use: (fn: {name: string}) => registered.push(fn.name)}};
		const [pre, post] = devWorkerProxy();

		const preResult = pre?.configureServer?.(server);
		const postHook = post?.configureServer?.(server);
		postHook?.();

		expect({
			enforce: [pre?.enforce, post?.enforce],
			preResult,
			registered,
		}).toEqual({
			enforce: ["pre", undefined],
			preResult: undefined,
			registered: ["closeWorkerConnection", "devRequestErrorHandler"],
		});
	});
});
