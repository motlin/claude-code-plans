import {mkdtempSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {mtimeEtag} from "../src/lib/file-edit";
import {writableMemoryFile} from "../src/lib/memory-file-write";
import {handleMemoryFileGet, handleMemoryFilePut} from "../src/routes/api/sessions.$id.memory-file";

const HOME = "/Users/alice";
const CWD = "/Users/alice/proj";

describe("writableMemoryFile", () =>
{
	it("allows only absolute, ..-free .md files the breakdown lists as User, Project or Local", () =>
	{
		const listed = [
			{
				path: `${HOME}/.claude/CLAUDE.md`,
				type: "User",
			},
			{
				path: `${CWD}/CLAUDE.local.md`,
				type: "Local",
			},
			{
				path: "/Library/ClaudeCode/CLAUDE.md",
				type: "Managed",
			},
			{
				path: `${HOME}/.claude/projects/-proj/memory/MEMORY.md`,
				type: "AutoMem",
			},
			{
				path: "/a/../b/CLAUDE.md",
				type: "Project",
			},
			{
				path: "proj/CLAUDE.md",
				type: "Project",
			},
			{
				path: `${CWD}/notes.txt`,
				type: "Project",
			},
		];
		expect(
			[...listed.map((file) => file.path), `${CWD}/CLAUDE.md`].map((path) => writableMemoryFile(path, listed)),
		).toStrictEqual([true, true, false, false, false, false, false, false]);
	});
});

describe("memory-file route", () =>
{
	let dir: string;
	let file: string;
	let managed: string;

	beforeEach(() =>
	{
		dir = realpathSync(mkdtempSync(join(tmpdir(), "memory-file-")));
		file = join(dir, "CLAUDE.md");
		managed = join(dir, "managed.md");
		writeFileSync(file, "one\n");
		writeFileSync(managed, "org\n");
	});

	afterEach(() =>
	{
		rmSync(
			dir,
			{
				recursive: true,
				force: true,
			},
		);
	});

	const deps =
	{
		memoryFiles: async () =>
			Promise.resolve([
				{
					path: file,
					type: "User",
				},
				{
					path: managed,
					type: "Managed",
				},
			]),
	};

	function url(path: string): string
	{
		return `http://localhost/api/sessions/abc/memory-file?path=${encodeURIComponent(path)}`;
	}

	function put(path: string, body: string, ifMatch?: string): Request
	{
		return new Request(
			url(path),
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

	async function summary(response: Response)
	{
		return {
			status: response.status,
			body: response.status === 204 ? null : await response.json(),
		};
	}

	it("reads listed files with their writability and refuses unlisted ones", async () =>
	{
		const etag = mtimeEtag(statSync(file).mtime);
		expect([
			await summary(await handleMemoryFileGet(new Request(url(file)), "abc", deps)),
			await summary(await handleMemoryFileGet(new Request(url(managed)), "abc", deps)),
			(await handleMemoryFileGet(new Request(url(join(dir, "other.md"))), "abc", deps)).status,
		]).toStrictEqual([
			{
				status: 200,
				body:
				{
					content: "one\n",
					writable: true,
					etag,
				},
			},
			{
				status: 200,
				body:
				{
					content: "org\n",
					writable: false,
					etag: mtimeEtag(statSync(managed).mtime),
				},
			},
			404,
		]);
	});

	it("refuses unwritable, stale and deleted targets, and writes a current one with a new ETag", async () =>
	{
		const denied = await summary(await handleMemoryFilePut(put(managed, "x"), "abc", deps));
		const unlisted = await summary(await handleMemoryFilePut(put(join(dir, "new.md"), "x"), "abc", deps));
		const stale = await handleMemoryFilePut(put(file, "x", '"stale"'), "abc", deps);
		const staleSummary = await summary(stale);
		const etag = mtimeEtag(statSync(file).mtime);
		const saved = await handleMemoryFilePut(put(file, "two\n", etag), "abc", deps);
		const contents = readFileSync(file, "utf-8");
		const newEtag = saved.headers.get("ETag");
		const diskEtag = mtimeEtag(statSync(file).mtime);
		unlinkSync(file);
		const missing = await summary(await handleMemoryFilePut(put(file, "three\n", newEtag ?? ""), "abc", deps));
		expect(
			{
				denied,
				unlisted,
				stale: staleSummary,
				saved: saved.status,
				contents,
				newEtag,
				missing,
			},
		).toStrictEqual(
			{
				denied:
				{
					status: 403,
					body:
					{
						reason: "denied",
					},
				},
				unlisted:
				{
					status: 403,
					body:
					{
						reason: "denied",
					},
				},
				stale:
				{
					status: 409,
					body:
					{
						reason: "conflict",
						etag,
					},
				},
				saved: 204,
				contents: "two\n",
				newEtag: diskEtag,
				missing:
				{
					status: 409,
					body:
					{
						reason: "missing",
					},
				},
			},
		);
	});
});
