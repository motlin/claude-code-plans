import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {handleOpenFile} from "../src/lib/open-in-finder";

describe("handleOpenFile", () => {
	let root: string;

	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "open-file-")));
		await mkdir(join(root, "allowed"));
		await writeFile(join(root, "allowed", "alice.md"), "alice");
		await writeFile(join(root, "allowed", "run.command"), "echo bob");
		await writeFile(join(root, "allowed", "build"), "#!/bin/sh\necho carol");
		await chmod(join(root, "allowed", "build"), 0o755);
		await writeFile(join(root, "outside.md"), "dave");
	});

	afterEach(async () => {
		await rm(root, {recursive: true, force: true});
	});

	async function openFile(body: unknown, openPath: (path: string) => Promise<void>) {
		const response = await handleOpenFile(
			new Request("http://localhost/api/open-file", {method: "POST", body: JSON.stringify(body)}),
			{
				rejectRequest: () => null,
				resolveRoots: async () => Promise.resolve([join(root, "allowed")]),
				configPath: join(root, "missing-config.json"),
				openPath,
			},
		);
		return {status: response.status, body: (await response.json()) as unknown};
	}

	it("opens an allowed regular file with its default app", async () => {
		const openPath = vi.fn<(path: string) => Promise<void>>(async () => {});
		const result = await openFile({path: join(root, "allowed", "alice.md")}, openPath);

		expect({result, opened: openPath.mock.calls}).toStrictEqual({
			result: {status: 200, body: {ok: true}},
			opened: [[join(root, "allowed", "alice.md")]],
		});
	});

	it("refuses paths outside the roots, folders, missing files and malformed bodies without opening anything", async () => {
		const openPath = vi.fn<(path: string) => Promise<void>>(async () => {});
		const statuses = [
			(await openFile({path: join(root, "outside.md")}, openPath)).status,
			(await openFile({path: join(root, "allowed")}, openPath)).status,
			(await openFile({path: join(root, "allowed", "gone.md")}, openPath)).status,
			(await openFile({path: 42}, openPath)).status,
		];

		expect({statuses, opened: openPath.mock.calls}).toStrictEqual({
			statuses: [403, 403, 404, 400],
			opened: [],
		});
	});

	it("refuses executables, by extension or by mode", async () => {
		const openPath = vi.fn<(path: string) => Promise<void>>(async () => {});
		const byExtension = await openFile({path: join(root, "allowed", "run.command")}, openPath);
		const byMode = await openFile({path: join(root, "allowed", "build")}, openPath);

		expect({results: [byExtension, byMode], opened: openPath.mock.calls}).toStrictEqual({
			results: [
				{status: 403, body: {error: "Blocked: executable"}},
				{status: 403, body: {error: "Blocked: executable"}},
			],
			opened: [],
		});
	});
});
