import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {fileRefStatCandidates, findUserFileMentions, parseFileRefText, resolveFileRefs} from "../src/lib/file-refs";
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

describe("parseFileRefText", () =>
{
	it.each([
		[
			"src/app.ts",
			{
				target: "src/app.ts",
			},
		],
		[
			"src/app.ts:12",
			{
				target: "src/app.ts",
				line: 12,
			},
		],
		[
			"src/app.ts:12-20",
			{
				target: "src/app.ts",
				line: 12,
				endLine: 20,
			},
		],
		[
			"/abs/path/file.md:3",
			{
				target: "/abs/path/file.md",
				line: 3,
			},
		],
		[
			"./src/app.ts",
			{
				target: "src/app.ts",
			},
		],
		[
			"lib/a(b)/c-d.test.tsx:3-9",
			{
				target: "lib/a(b)/c-d.test.tsx",
				line: 3,
				endLine: 9,
			},
		],
		[
			"src/a.ts:12:5",
			{
				target: "src/a.ts",
				line: 12,
			},
		],
		[
			"a/b.ts:9-3",
			{
				target: "a/b.ts",
				line: 3,
				endLine: 9,
			},
		],
		[
			"src/app.ts:20-12",
			{
				target: "src/app.ts",
				line: 12,
				endLine: 20,
			},
		],
		[
			"src/app.ts:7-7",
			{
				target: "src/app.ts",
				line: 7,
			},
		],
		[
			"src/é/ü.ts",
			{
				target: "src/é/ü.ts",
			},
		],
	])("%s", (text, expected) =>
	{
		expect(parseFileRefText(text)).toStrictEqual(expected);
	});

	it.each([
		"logs/",
		"test",
		"just test",
		"https://example.com/a.json",
		"foo(bar)",
		"*.ts",
		"~/notes.md",
		"README.md",
		"package.json",
		".gitignore",
		"docs/guide.md#install",
		"/etc/hostname",
		"/a.ts",
		"/a.ts:3",
		"C:\\x\\y.ts",
		"",
	])("%s is not a file ref", (text) =>
	{
		expect(parseFileRefText(text)).toBeNull();
	});
});

describe("findUserFileMentions (upstream fe in c8a6d9da5)", () =>
{
	it("finds whitespace-led @paths, trimming trailing punctuation and unbalanced closers", () =>
	{
		expect([
			findUserFileMentions("see @src/a.ts, ok"),
			findUserFileMentions("(see @src/a.ts)"),
			findUserFileMentions("@src\\b.ts."),
		]).toStrictEqual([
			[
				{
					index: 4,
					text: "@src/a.ts",
					target: "src/a.ts",
					folder: false,
				},
			],
			[
				{
					index: 5,
					text: "@src/a.ts",
					target: "src/a.ts",
					folder: false,
				},
			],
			[
				{
					index: 0,
					text: "@src\\b.ts",
					target: "src/b.ts",
					folder: false,
				},
			],
		]);
	});

	it("takes a folder by its trailing slash and a bare name only with a known code extension", () =>
	{
		expect([
			findUserFileMentions("@docs/"),
			findUserFileMentions("@README.md and @main.py"),
			findUserFileMentions("@./ and @../"),
		]).toStrictEqual([
			[
				{
					index: 0,
					text: "@docs/",
					target: "docs",
					folder: true,
				},
			],
			[
				{
					index: 0,
					text: "@README.md",
					target: "README.md",
					folder: false,
				},
				{
					index: 15,
					text: "@main.py",
					target: "main.py",
					folder: false,
				},
			],
			[],
		]);
	});

	it.each([
		"@notes.zzz",
		"@foo",
		"@src/Makefile",
		"a@src/a.ts",
		"[x](@src/a.ts)",
		"see [link @src/a.ts](https://e.com)",
		`@src/${"a".repeat(1100)}.ts`,
		"no mentions",
	])("%s has no mention", (text) =>
	{
		expect(findUserFileMentions(text)).toStrictEqual([]);
	});

	it("stops after 256 mentions", () =>
	{
		const mentions = findUserFileMentions(
			Array.from(
				{
					length: 300,
				},
				(_, i) => `@src/f${i}.ts`,
			).join(" "),
		);
		expect(
			{
				count: mentions.length,
				last: mentions.at(-1)?.target,
			},
		).toStrictEqual(
			{
				count: 256,
				last: "src/f255.ts",
			},
		);
	});
});

describe("fileRefStatCandidates", () =>
{
	it("asks the server about each path-like token, joined to cwd, plus matching session paths", () =>
	{
		expect(
			fileRefStatCandidates(
				[...UPSTREAM_INLINE_CODES, "components/shared.tsx", "/elsewhere/abs.ts:4"],
				["/repo/src/components/shared.tsx", "/repo/src/other.ts"],
				"/repo",
			),
		).toStrictEqual([
			"/repo/.mise/config.toml",
			"/repo/components/shared.tsx",
			"/repo/src/components/shared.tsx",
			"/elsewhere/abs.ts",
		]);
	});

	it("without a cwd only absolute tokens and session-path suffix matches are candidates", () =>
	{
		expect(
			fileRefStatCandidates(["src/other.ts", "a/mise.toml", "/abs/x.md"], ["/repo/src/other.ts"], undefined),
		).toStrictEqual(["/repo/src/other.ts", "/abs/x.md"]);
	});
});

describe("resolveFileRefs", () =>
{
	it("links only inline code that resolves to a known existing file (upstream fixture)", () =>
	{
		const refs = resolveFileRefs(UPSTREAM_INLINE_CODES, ["/repo/.mise/config.toml"], "/repo");
		expect([...refs]).toStrictEqual([
			[
				".mise/config.toml",
				{
					path: "/repo/.mise/config.toml",
				},
			],
		]);
	});

	it("carries a :line-end suffix through to the ref", () =>
	{
		const refs = resolveFileRefs(["src/app.ts:12-20", "src/app.ts:7"], ["/repo/src/app.ts"], "/repo");
		expect([...refs]).toStrictEqual([
			[
				"src/app.ts:12-20",
				{
					path: "/repo/src/app.ts",
					line: 12,
					endLine: 20,
				},
			],
			[
				"src/app.ts:7",
				{
					path: "/repo/src/app.ts",
					line: 7,
				},
			],
		]);
	});

	it("resolves absolute paths and unique session-path suffixes, but not ambiguous ones", () =>
	{
		const refs = resolveFileRefs(
			["/abs/x.md", "components/shared.tsx", "src/index.ts"],
			["/abs/x.md", "/repo/src/components/shared.tsx", "/repo/a/src/index.ts", "/repo/b/src/index.ts"],
			"/repo",
		);
		expect([...refs]).toStrictEqual([
			[
				"/abs/x.md",
				{
					path: "/abs/x.md",
				},
			],
			[
				"components/shared.tsx",
				{
					path: "/repo/src/components/shared.tsx",
				},
			],
		]);
	});

	it("blocks a ref that names a path outside the roots, preferring an existing match", () =>
	{
		const refs = resolveFileRefs(
			["/tmp/outside/notes.txt:4", "src/app.ts", "/repo/gone.ts"],
			["/repo/src/app.ts"],
			"/repo",
			["/tmp/outside/notes.txt", "/elsewhere/src/app.ts"],
		);
		expect([...refs]).toStrictEqual([
			[
				"/tmp/outside/notes.txt:4",
				{
					path: "/tmp/outside/notes.txt",
					line: 4,
					block: "outside_roots",
				},
			],
			[
				"src/app.ts",
				{
					path: "/repo/src/app.ts",
				},
			],
		]);
	});
	it("links a missing path inside the roots optimistically, after existing and outside matches", () =>
	{
		const refs = resolveFileRefs(
			["src/new.ts:3", "src/app.ts", "/tmp/outside/notes.txt", "/elsewhere/x.ts"],
			["/repo/src/app.ts"],
			"/repo",
			["/tmp/outside/notes.txt"],
			["/repo/src/new.ts", "/repo/src/app.ts", "/tmp/outside/notes.txt"],
		);
		expect([...refs]).toStrictEqual([
			[
				"src/new.ts:3",
				{
					path: "/repo/src/new.ts",
					line: 3,
				},
			],
			[
				"src/app.ts",
				{
					path: "/repo/src/app.ts",
				},
			],
			[
				"/tmp/outside/notes.txt",
				{
					path: "/tmp/outside/notes.txt",
					block: "outside_roots",
				},
			],
		]);
	});
});

describe("handleFileRefsRequest", () =>
{
	let fixture: string;
	let allowedRoot: string;
	let outsideRoot: string;
	let configPath: string;

	beforeEach(() =>
	{
		fixture = realpathSync(mkdtempSync(join(tmpdir(), "file-refs-")));
		allowedRoot = join(fixture, "allowed");
		outsideRoot = join(fixture, "outside");
		mkdirSync(
			join(allowedRoot, ".mise"),
			{
				recursive: true,
			},
		);
		mkdirSync(
			join(allowedRoot, "logs"),
			{
				recursive: true,
			},
		);
		mkdirSync(
			outsideRoot,
			{
				recursive: true,
			},
		);
		writeFileSync(join(allowedRoot, ".mise", "config.toml"), "[tools]\n");
		writeFileSync(join(outsideRoot, "secret.txt"), "nope\n");
		configPath = join(fixture, "config.json");
		writeFileSync(
			configPath,
			JSON.stringify(
				{
					file_roots: [allowedRoot],
				},
			),
		);
	});

	afterEach(() =>
	{
		rmSync(
			fixture,
			{
				recursive: true,
				force: true,
			},
		);
	});

	function request(body: unknown, headers: Record<string, string> = {}): Request
	{
		return new Request(
			"http://127.0.0.1:7526/api/file-refs",
			{
				method: "POST",
				headers:
				{
					"Content-Type": "application/json",
					...headers,
				},
				body: JSON.stringify(body),
			},
		);
	}

	it("reports whether each path exists inside the allowed roots, is missing there, or is outside them", async () =>
	{
		symlinkSync(join(outsideRoot, "secret.txt"), join(allowedRoot, "escape.txt"));
		const paths = [
			join(allowedRoot, ".mise", "config.toml"),
			join(allowedRoot, "mise.toml"),
			join(allowedRoot, "missing-dir", "a.ts"),
			join(allowedRoot, "logs"),
			join(allowedRoot, "escape.txt"),
			join(outsideRoot, "secret.txt"),
			join(outsideRoot, "x.txt"),
			join(allowedRoot, "..", "outside", "y.txt"),
			"relative/path.ts",
		];
		const response = await handleFileRefsRequest(
			request(
				{
					paths,
				},
			),
			configPath,
		);
		expect(
			{
				status: response.status,
				body: await response.json(),
			},
		).toStrictEqual(
			{
				status: 200,
				body:
				{
					statuses:
					{
						[join(allowedRoot, ".mise", "config.toml")]: "exists",
						[join(allowedRoot, "mise.toml")]: "missing",
						[join(allowedRoot, "missing-dir", "a.ts")]: "missing",
						[join(allowedRoot, "logs")]: "missing",
						[join(allowedRoot, "escape.txt")]: "outside",
						[join(outsideRoot, "secret.txt")]: "outside",
						[join(outsideRoot, "x.txt")]: "outside",
						[join(allowedRoot, "..", "outside", "y.txt")]: "outside",
						"relative/path.ts": "outside",
					},
				},
			},
		);
	});

	it("marks /tmp/outside/x.txt outside when the only root is /repo", async () =>
	{
		const emptyConfig = join(fixture, "empty-config.json");
		writeFileSync(emptyConfig, "{}");
		const response = await handleFileRefsRequest(
			request(
				{
					paths: ["/tmp/outside/x.txt"],
				},
			),
			emptyConfig,
			["/repo"],
		);
		expect(await response.json()).toStrictEqual(
			{
				statuses:
				{
					"/tmp/outside/x.txt": "outside",
				},
			},
		);
	});

	it("rejects a malformed body", async () =>
	{
		const response = await handleFileRefsRequest(
			request(
				{
					paths: "nope",
				},
			),
			configPath,
		);
		expect(response.status).toBe(400);
	});

	it("rejects a cross-site request", async () =>
	{
		const response = await handleFileRefsRequest(
			request(
				{
					paths: [],
				},
				{
					Origin: "https://evil.example",
					"Sec-Fetch-Site": "cross-site",
				},
			),
			configPath,
		);
		expect(response.status).toBe(403);
	});
});
