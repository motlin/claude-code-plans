import {
	DEV_SERVER_BASH_RESULT_LIMIT,
	extractDevServerUrls,
	isLoopbackHost,
	latestBashResultTexts,
	launchJsonDevServers,
	mergeDevServers,
} from "../src/lib/dev-server-links";
import {probeDevServer} from "../src/lib/dev-server-probe";
import {readSessionDevServers} from "../src/lib/session-dev-servers";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

function bashUse(id: string, command = "pnpm dev") {
	return {
		type: "assistant",
		message: {
			role: "assistant",
			content: [{type: "tool_use", id, name: "Bash", input: {command}}],
		},
	};
}

function toolResult(toolUseId: string, content: unknown) {
	return {
		type: "user",
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: toolUseId, content}],
		},
	};
}

describe("extractDevServerUrls", () => {
	it("returns loopback origins once each, in first-seen order", () => {
		expect(
			extractDevServerUrls([
				"  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.4:5173/",
				"curl http://127.0.0.1:7526/api/events and http://localhost:5173/sessions",
				"listening on HTTP://LOCALHOST:3000.",
			]),
		).toStrictEqual(["http://localhost:5173", "http://127.0.0.1:7526", "http://localhost:3000"]);
	});

	it("ignores ANSI styling inside the URL", () => {
		expect(
			extractDevServerUrls(["Local: \u001B[36mhttp://localhost:\u001B[1m5173\u001B[22m/\u001B[39m"]),
		).toStrictEqual(["http://localhost:5173"]);
	});

	it("accepts ports 1 through 65535 only", () => {
		expect(
			extractDevServerUrls([
				"http://localhost:0/ http://localhost:1/ http://localhost:65535/ http://localhost:65536/ http://localhost:123456/",
			]),
		).toStrictEqual(["http://localhost:1", "http://localhost:65535"]);
	});

	it("skips URLs without an explicit port", () => {
		expect(extractDevServerUrls(["http://localhost/ and https://127.0.0.1/x"])).toStrictEqual([]);
	});

	it("skips non-loopback hosts, including lookalikes", () => {
		expect(
			extractDevServerUrls([
				"http://example.com:8080/ http://localhost.evil.com:8080/ http://127.0.0.1.nip.io:80/ http://10.0.0.1:3000/ http://mylocalhost:3000/",
			]),
		).toStrictEqual([]);
	});

	it("keeps https and IPv6 loopback", () => {
		expect(extractDevServerUrls(["https://localhost:8443/ http://[::1]:4000/"])).toStrictEqual([
			"https://localhost:8443",
			"http://[::1]:4000",
		]);
	});
});

describe("isLoopbackHost", () => {
	it("accepts loopback names and addresses", () => {
		expect(["localhost", "127.0.0.1", "127.1.2.3", "[::1]", "::1"].map(isLoopbackHost)).toStrictEqual([
			true,
			true,
			true,
			true,
			true,
		]);
	});

	it("refuses everything else", () => {
		expect(
			["example.com", "localhost.example.com", "10.0.0.1", "0.0.0.0", "128.0.0.1", "[::2]", ""].map(
				isLoopbackHost,
			),
		).toStrictEqual([false, false, false, false, false, false, false]);
	});
});

describe("latestBashResultTexts", () => {
	it("returns Bash result text newest first, skipping other tools", () => {
		const records = [
			bashUse("a"),
			toolResult("a", "first http://localhost:1111/"),
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{type: "tool_use", id: "r", name: "Read", input: {file_path: "/x"}}],
				},
			},
			toolResult("r", "read http://localhost:2222/"),
			bashUse("b"),
			toolResult("b", [{type: "text", text: "second http://localhost:3333/"}]),
		];
		expect(latestBashResultTexts(records)).toStrictEqual([
			"second http://localhost:3333/",
			"first http://localhost:1111/",
		]);
	});

	it("keeps only the latest 20 results", () => {
		const records = Array.from({length: 25}, (_, index) => [
			bashUse(`t${index}`),
			toolResult(`t${index}`, `out ${index}`),
		]).flat();
		const texts = latestBashResultTexts(records);
		expect(DEV_SERVER_BASH_RESULT_LIMIT).toBe(20);
		expect(texts).toStrictEqual(Array.from({length: 20}, (_, index) => `out ${24 - index}`));
	});
});

describe("launchJsonDevServers", () => {
	it("maps configurations with a port to localhost URLs", () => {
		expect(
			launchJsonDevServers({
				version: "0.0.1",
				configurations: [
					{name: "web", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], port: 5173},
					{name: "no port", runtimeExecutable: "pnpm"},
					{name: "bad port", port: 70000},
				],
			}),
		).toStrictEqual([{url: "http://localhost:5173", name: "web"}]);
	});

	it("returns nothing for malformed input", () => {
		expect(launchJsonDevServers({configurations: "nope"})).toStrictEqual([]);
		expect(launchJsonDevServers(null)).toStrictEqual([]);
	});
});

describe("mergeDevServers", () => {
	it("puts launch.json servers first and drops duplicate URLs", () => {
		expect(
			mergeDevServers(
				[{url: "http://localhost:5173", name: "web"}],
				["http://localhost:3000", "http://localhost:5173"],
			),
		).toStrictEqual([{url: "http://localhost:5173", name: "web"}, {url: "http://localhost:3000"}]);
	});
});

describe("probeDevServer", () => {
	it("refuses non-loopback hosts without fetching", async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		const results = await Promise.all(
			[
				"http://example.com:80/",
				"http://localhost.example.com:3000/",
				"http://10.0.0.1:3000/",
				"file:///etc/passwd",
				"not a url",
			].map((url) => probeDevServer(url, fetchImpl)),
		);
		expect(results).toStrictEqual(["refused", "refused", "refused", "refused", "refused"]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("sends a HEAD without following redirects and reports live on any response", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, {status: 404}));
		expect(await probeDevServer("http://localhost:5173", fetchImpl)).toBe("live");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] ?? [];
		expect(url).toBe("http://localhost:5173/");
		expect({method: init?.method, redirect: init?.redirect}).toStrictEqual({
			method: "HEAD",
			redirect: "manual",
		});
	});

	it("reports down when the connection fails", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => {
			throw new TypeError("fetch failed");
		});
		expect(await probeDevServer("http://127.0.0.1:5999", fetchImpl)).toBe("down");
	});
});

describe("readSessionDevServers", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "dev-server-links-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, {recursive: true, force: true});
	});

	it("merges launch.json and Bash URLs and probes each one", async () => {
		const transcript = join(tempDir, "session.jsonl");
		writeFileSync(
			transcript,
			[
				bashUse("a"),
				toolResult("a", "Local: http://localhost:3000/ and https://example.com:443/"),
				bashUse("b"),
				toolResult("b", "ready on http://localhost:5173"),
			]
				.map((record) => JSON.stringify(record))
				.join("\n") + "\nnot json\n",
		);
		mkdirSync(join(tempDir, ".claude"));
		writeFileSync(
			join(tempDir, ".claude", "launch.json"),
			JSON.stringify({version: "0.0.1", configurations: [{name: "web", port: 5173}]}),
		);
		const fetchImpl = vi.fn<typeof fetch>(async (input) => {
			if (input === "http://localhost:5173/") return new Response(null, {status: 200});
			throw new TypeError("fetch failed");
		});

		expect(await readSessionDevServers(transcript, tempDir, fetchImpl)).toStrictEqual([
			{url: "http://localhost:5173", name: "web", live: true},
			{url: "http://localhost:3000", live: false},
		]);
	});

	it("returns nothing when there is no transcript or project directory", async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		expect(await readSessionDevServers(undefined, null, fetchImpl)).toStrictEqual([]);
		expect(
			await readSessionDevServers(join(tempDir, "missing.jsonl"), join(tempDir, "nope"), fetchImpl),
		).toStrictEqual([]);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
