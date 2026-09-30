import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {fileRefStatCandidates, parseFileRefText, resolveFileRefs} from "../src/lib/file-refs";
import {handleFileRefsRequest} from "../src/lib/file-refs-handler";

/** Inline code from the upstream message where only `.mise/config.toml` became a file ref. */
const UPSTREAM_INLINE_CODES = [
	".mise/config.toml",
	"mise.toml",
	"logs/",
	"test",
	"package.json",
	"just test",
	"https://example.com/a.json",
];

describe("parseFileRefText", () => {
	it.each([
		["src/app.ts", {target: "src/app.ts"}],
		["src/app.ts:12", {target: "src/app.ts", line: 12}],
		["src/app.ts:12-20", {target: "src/app.ts", line: 12, endLine: 20}],
		["/abs/path/file.md:3", {target: "/abs/path/file.md", line: 3}],
		["./src/app.ts", {target: "src/app.ts"}],
		[".gitignore", {target: ".gitignore"}],
	])("%s", (text, expected) => {
		expect(parseFileRefText(text)).toStrictEqual(expected);
	});

	it.each([
		"logs/",
		"test",
		"just test",
		"https://example.com/a.json",
		"foo(bar)",
		"*.ts",
		"src/app.ts:20-12",
		"~/notes.md",
		"",
	])("%s is not a file ref", (text) => {
		expect(parseFileRefText(text)).toBeNull();
	});
});

describe("fileRefStatCandidates", () => {
	it("asks the server about each path-like token, joined to cwd, plus matching session paths", () => {
		expect(
			fileRefStatCandidates(
				[...UPSTREAM_INLINE_CODES, "shared.tsx", "/elsewhere/abs.ts:4"],
				["/repo/src/components/shared.tsx", "/repo/src/other.ts"],
				"/repo",
			),
		).toStrictEqual([
			"/repo/.mise/config.toml",
			"/repo/mise.toml",
			"/repo/package.json",
			"/repo/shared.tsx",
			"/repo/src/components/shared.tsx",
			"/elsewhere/abs.ts",
		]);
	});

	it("without a cwd only absolute tokens and session-path suffix matches are candidates", () => {
		expect(
			fileRefStatCandidates(["src/other.ts", "mise.toml", "/abs/x.md"], ["/repo/src/other.ts"], undefined),
		).toStrictEqual(["/repo/src/other.ts", "/abs/x.md"]);
	});
});

describe("resolveFileRefs", () => {
	it("links only inline code that resolves to a known existing file (upstream fixture)", () => {
		const refs = resolveFileRefs(UPSTREAM_INLINE_CODES, ["/repo/.mise/config.toml"], "/repo");
		expect([...refs]).toStrictEqual([[".mise/config.toml", {path: "/repo/.mise/config.toml"}]]);
	});

	it("carries a :line-end suffix through to the ref", () => {
		const refs = resolveFileRefs(["src/app.ts:12-20", "src/app.ts:7"], ["/repo/src/app.ts"], "/repo");
		expect([...refs]).toStrictEqual([
			["src/app.ts:12-20", {path: "/repo/src/app.ts", line: 12, endLine: 20}],
			["src/app.ts:7", {path: "/repo/src/app.ts", line: 7}],
		]);
	});

	it("resolves absolute paths and unique session-path suffixes, but not ambiguous ones", () => {
		const refs = resolveFileRefs(
			["/abs/x.md", "shared.tsx", "index.ts"],
			["/abs/x.md", "/repo/src/components/shared.tsx", "/repo/a/index.ts", "/repo/b/index.ts"],
			"/repo",
		);
		expect([...refs]).toStrictEqual([
			["/abs/x.md", {path: "/abs/x.md"}],
			["shared.tsx", {path: "/repo/src/components/shared.tsx"}],
		]);
	});
});

describe("handleFileRefsRequest", () => {
	let fixture: string;
	let allowedRoot: string;
	let outsideRoot: string;
	let configPath: string;

	beforeEach(() => {
		fixture = realpathSync(mkdtempSync(join(tmpdir(), "file-refs-")));
		allowedRoot = join(fixture, "allowed");
		outsideRoot = join(fixture, "outside");
		mkdirSync(join(allowedRoot, ".mise"), {recursive: true});
		mkdirSync(join(allowedRoot, "logs"), {recursive: true});
		mkdirSync(outsideRoot, {recursive: true});
		writeFileSync(join(allowedRoot, ".mise", "config.toml"), "[tools]\n");
		writeFileSync(join(outsideRoot, "secret.txt"), "nope\n");
		configPath = join(fixture, "config.json");
		writeFileSync(configPath, JSON.stringify({file_roots: [allowedRoot]}));
	});

	afterEach(() => {
		rmSync(fixture, {recursive: true, force: true});
	});

	function request(body: unknown, headers: Record<string, string> = {}): Request {
		return new Request("http://127.0.0.1:7526/api/file-refs", {
			method: "POST",
			headers: {"Content-Type": "application/json", ...headers},
			body: JSON.stringify(body),
		});
	}

	it("returns only existing regular files inside the allowed roots", async () => {
		const paths = [
			join(allowedRoot, ".mise", "config.toml"),
			join(allowedRoot, "mise.toml"),
			join(allowedRoot, "logs"),
			join(outsideRoot, "secret.txt"),
			"relative/path.ts",
		];
		const response = await handleFileRefsRequest(request({paths}), configPath);
		expect({status: response.status, body: await response.json()}).toStrictEqual({
			status: 200,
			body: {existing: [join(allowedRoot, ".mise", "config.toml")]},
		});
	});

	it("rejects a malformed body", async () => {
		const response = await handleFileRefsRequest(request({paths: "nope"}), configPath);
		expect(response.status).toBe(400);
	});

	it("rejects a cross-site request", async () => {
		const response = await handleFileRefsRequest(
			request({paths: []}, {Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site"}),
			configPath,
		);
		expect(response.status).toBe(403);
	});
});
