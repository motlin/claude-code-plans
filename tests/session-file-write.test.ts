import
{
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {encodeFilePath} from "../src/lib/api/file";
import {mtimeEtag} from "../src/lib/file-edit";
import {isLossyDecode, writableWorkspacePath} from "../src/lib/session-file-write";
import {handleFileRequest, handleFileWrite} from "../src/routes/api/file.$";

let fixture: string;
let root: string;
let outside: string;
let configPath: string;

beforeEach(() =>
{
	fixture = realpathSync(mkdtempSync(join(tmpdir(), "session-file-write-")));
	root = join(fixture, "root");
	outside = join(fixture, "outside");
	configPath = join(fixture, "config.json");
	mkdirSync(
		join(root, ".git"),
		{
			recursive: true,
		},
	);
	mkdirSync(outside);
	writeFileSync(join(root, "inside.ts"), "inside\n");
	writeFileSync(join(root, ".git", "config"), "[core]\n");
	writeFileSync(join(outside, "secret.ts"), "secret\n");
	symlinkSync(join(outside, "secret.ts"), join(root, "escape.ts"));
	writeFileSync(
		configPath,
		JSON.stringify(
			{
				file_roots: [root],
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

describe("writableWorkspacePath", () =>
{
	it("allows only absolute, traversal-free paths that resolve inside a root and outside .git", async () =>
	{
		const cases =
		{
			inside: join(root, "inside.ts"),
			newFile: join(root, "new.ts"),
			sibling: join(outside, "secret.ts"),
			symlinkOut: join(root, "escape.ts"),
			dotDot: `${root}/../outside/secret.ts`,
			relative: "root/inside.ts",
			gitConfig: join(root, ".git", "config"),
		};
		const results = Object.fromEntries(
			await Promise.all(
				Object.entries(cases).map(async ([name, path]) => [name, await writableWorkspacePath(path, [root])]),
			),
		);
		expect(results).toStrictEqual(
			{
				inside: true,
				newFile: true,
				sibling: false,
				symlinkOut: false,
				dotDot: false,
				relative: false,
				gitConfig: false,
			},
		);
	});
});

describe("isLossyDecode", () =>
{
	it("is true only when decoding replaced bytes with U+FFFD", () =>
	{
		const valid = Buffer.from("a�b", "utf8");
		const invalid = Buffer.from([0x61, 0xff, 0x62]);
		expect(
			{
				valid: isLossyDecode(valid, valid.toString("utf8")),
				invalid: isLossyDecode(invalid, invalid.toString("utf8")),
				plain: isLossyDecode(Buffer.from("plain"), "plain"),
			},
		).toStrictEqual(
			{
				valid: false,
				invalid: true,
				plain: false,
			},
		);
	});
});

function put(path: string, body: string, ifMatch?: string): Request
{
	return new Request(
		`http://127.0.0.1:7526/api/file/${encodeFilePath(path)}`,
		{
			method: "PUT",
			body,
			headers:
				ifMatch === undefined
					? {}
					:
						{
							"If-Match": ifMatch,
						},
		},
	);
}

async function describeResponse(response: Response): Promise<
{
	status: number;
	body: unknown;
	etag: string | null;
}>
{
	const text = await response.text();
	return {
		status: response.status,
		body: text === "" ? null : JSON.parse(text),
		etag: response.headers.get("ETag"),
	};
}

describe("PUT /api/file/$", () =>
{
	it("refuses a path outside the roots with 403 denied, leaving it untouched", async () =>
	{
		const target = join(outside, "secret.ts");
		const response = await handleFileWrite(put(target, "changed\n"), encodeFilePath(target), configPath);
		expect(
			{
				response: await describeResponse(response),
				disk: readFileSync(target, "utf8"),
			},
		).toStrictEqual(
			{
				response:
				{
					status: 403,
					body:
					{
						reason: "denied",
					},
					etag: null,
				},
				disk: "secret\n",
			},
		);
	});

	it("refuses a stale If-Match with 409 conflict and a deleted file with 409 missing", async () =>
	{
		const target = join(root, "inside.ts");
		const gone = join(root, "gone.ts");
		const conflict = await handleFileWrite(put(target, "changed\n", '"1"'), encodeFilePath(target), configPath);
		const missing = await handleFileWrite(put(gone, "changed\n", '"1"'), encodeFilePath(gone), configPath);
		expect(
			{
				conflict: await describeResponse(conflict),
				missing: await describeResponse(missing),
				disk: readFileSync(target, "utf8"),
			},
		).toStrictEqual(
			{
				conflict:
				{
					status: 409,
					body:
					{
						reason: "conflict",
					},
					etag: null,
				},
				missing:
				{
					status: 409,
					body:
					{
						reason: "missing",
					},
					etag: null,
				},
				disk: "inside\n",
			},
		);
	});

	it("writes the body with a current If-Match and returns 204 with the new ETag", async () =>
	{
		const target = join(root, "inside.ts");
		const response = await handleFileWrite(
			put(target, "saved\n", mtimeEtag(statSync(target).mtime)),
			encodeFilePath(target),
			configPath,
		);
		expect(
			{
				response: await describeResponse(response),
				disk: readFileSync(target, "utf8"),
			},
		).toStrictEqual(
			{
				response:
				{
					status: 204,
					body: null,
					etag: mtimeEtag(statSync(target).mtime),
				},
				disk: "saved\n",
			},
		);
	});

	it("refuses a cross-site write", async () =>
	{
		const target = join(root, "inside.ts");
		const request = new Request(
			`http://127.0.0.1:7526/api/file/${encodeFilePath(target)}`,
			{
				method: "PUT",
				body: "evil\n",
				headers:
				{
					Origin: "https://evil.example",
				},
			},
		);
		const response = await handleFileWrite(request, encodeFilePath(target), configPath);
		expect([response.status, readFileSync(target, "utf8")]).toStrictEqual([403, "inside\n"]);
	});
});

describe("GET /api/file/$ editing metadata", () =>
{
	it("reports the mtime ETag, whether the file is writable, and whether its decode was lossy", async () =>
	{
		const inside = join(root, "inside.ts");
		const lossy = join(root, "lossy.txt");
		writeFileSync(lossy, Buffer.from([0x61, 0xff, 0x0a]));
		const read = async (path: string) =>
			(
				await handleFileRequest(
					new Request(`http://127.0.0.1:7526/api/file/${encodeFilePath(path)}`),
					encodeFilePath(path),
					configPath,
				)
			).json();
		expect(
			{
				inside: await read(inside),
				lossy: await read(lossy),
			},
		).toStrictEqual(
			{
				inside:
				{
					content: "inside\n",
					path: inside,
					etag: mtimeEtag(statSync(inside).mtime),
					writable: true,
					lossy: false,
				},
				lossy:
				{
					content: "a�\n",
					path: lossy,
					etag: mtimeEtag(statSync(lossy).mtime),
					writable: true,
					lossy: true,
				},
			},
		);
	});
});
