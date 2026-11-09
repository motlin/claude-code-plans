import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {composePrompt, contextChipLabel, type ContextAttachment} from "../src/lib/context-attach";
import {MAX_ATTACHMENT_BYTES} from "../src/lib/api/attachments";

type ApiHandler = (context: {request: Request}) => Response | Promise<Response>;

const URL_ = "http://localhost:7599/api/attachments";

let cacheHome: string;

beforeEach(() => {
	cacheHome = mkdtempSync(join(tmpdir(), "api-attachments-test-"));
	vi.stubEnv("XDG_CACHE_HOME", cacheHome);
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(cacheHome, {recursive: true, force: true});
});

async function postHandler(): Promise<ApiHandler> {
	const {Route} = await import("../src/routes/api/attachments");
	const handlers = (Route as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server
		.handlers;
	return handlers["POST"]!;
}

async function getHandler(): Promise<ApiHandler> {
	const {Route} = await import("../src/routes/api/attachments");
	const handlers = (Route as unknown as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server
		.handlers;
	return handlers["GET"]!;
}

function read(path: string): Request {
	return new Request(`${URL_}?path=${encodeURIComponent(path)}`);
}

function upload(file: File, headers: Record<string, string> = {}): Request {
	const form = new FormData();
	form.append("file", file);
	return new Request(URL_, {method: "POST", headers, body: form});
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("POST /api/attachments", () => {
	it("saves an image under the cache dir's attachments folder and returns its absolute path", async () => {
		const post = await postHandler();
		const response = await post({
			request: upload(new File([PNG_BYTES], "screenshot.png", {type: "image/png"}), {
				"Sec-Fetch-Site": "same-origin",
			}),
		});
		const body = (await response.json()) as {
			path: string;
			name: string;
			mediaType: string;
			size: number;
		};

		const attachmentsDir = join(cacheHome, "claude-code-plans", "attachments");
		expect({
			status: response.status,
			dir: dirname(body.path),
			fileName: /^[0-9a-f-]{36}\.png$/.test(body.path.slice(attachmentsDir.length + 1)),
			name: body.name,
			mediaType: body.mediaType,
			size: body.size,
			bytes: [...readFileSync(body.path)],
		}).toStrictEqual({
			status: 201,
			dir: attachmentsDir,
			fileName: true,
			name: "screenshot.png",
			mediaType: "image/png",
			size: PNG_BYTES.length,
			bytes: [...PNG_BYTES],
		});
	});

	it("keeps a text file's extension", async () => {
		const post = await postHandler();
		const response = await post({
			request: upload(new File(["# Notes\n"], "notes.md", {type: "text/markdown"})),
		});
		const body = (await response.json()) as {path: string; mediaType: string};

		expect({
			status: response.status,
			extension: body.path.endsWith(".md"),
			mediaType: body.mediaType,
			text: readFileSync(body.path, "utf8"),
		}).toStrictEqual({
			status: 201,
			extension: true,
			mediaType: "text/markdown",
			text: "# Notes\n",
		});
	});

	it("rejects cross-site uploads without writing anything", async () => {
		const post = await postHandler();
		const crossSite = await post({
			request: upload(new File([PNG_BYTES], "a.png", {type: "image/png"}), {
				"Sec-Fetch-Site": "cross-site",
			}),
		});
		const foreignOrigin = await post({
			request: upload(new File([PNG_BYTES], "a.png", {type: "image/png"}), {
				Origin: "https://evil.example",
			}),
		});

		expect({
			crossSite: crossSite.status,
			foreignOrigin: foreignOrigin.status,
			wrote: existsSync(join(cacheHome, "claude-code-plans", "attachments")),
		}).toStrictEqual({crossSite: 403, foreignOrigin: 403, wrote: false});
	});

	it("rejects files over 5 MB", async () => {
		const post = await postHandler();
		const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "big.png", {
			type: "image/png",
		});
		const response = await post({request: upload(big)});

		expect({
			status: response.status,
			wrote: existsSync(join(cacheHome, "claude-code-plans", "attachments")),
		}).toStrictEqual({status: 413, wrote: false});
	});

	it("rejects types other than images and text, and a missing file", async () => {
		const post = await postHandler();
		const binary = await post({
			request: upload(new File([PNG_BYTES], "tool.bin", {type: "application/octet-stream"})),
		});
		const missing = await post({
			request: new Request(URL_, {method: "POST", body: new FormData()}),
		});

		expect({binary: binary.status, missing: missing.status}).toStrictEqual({
			binary: 415,
			missing: 400,
		});
	});
});

describe("GET /api/attachments", () => {
	function savedDir(): string {
		const dir = join(cacheHome, "claude-code-plans", "attachments");
		mkdirSync(dir, {recursive: true});
		return dir;
	}

	it("serves a saved attachment's bytes as UTF-8 text", async () => {
		const path = join(savedDir(), "notes.md");
		writeFileSync(path, "# Notes\n\n- one");
		const get = await getHandler();

		const response = await get({request: read(path)});

		expect({
			status: response.status,
			type: response.headers.get("Content-Type"),
			body: await response.text(),
		}).toStrictEqual({status: 200, type: "text/plain; charset=utf-8", body: "# Notes\n\n- one"});
	});

	it("refuses paths outside the attachments folder, through .. or a symlink, and 404s a missing file", async () => {
		const dir = savedDir();
		const outside = join(cacheHome, "secret.txt");
		writeFileSync(outside, "secret");
		symlinkSync(outside, join(dir, "link.md"));
		const get = await getHandler();

		const statuses = await Promise.all(
			[outside, `${dir}/../../secret.txt`, join(dir, "link.md"), join(dir, "gone.md"), "relative.md"].map(
				async (path) => (await get({request: read(path)})).status,
			),
		);

		expect(statuses).toStrictEqual([403, 403, 403, 404, 400]);
	});
});

describe("attachment chips", () => {
	it("labels images by name", () => {
		expect(
			contextChipLabel({
				kind: "image",
				path: "/cache/claude-code-plans/attachments/0b1c.png",
				name: "screenshot.png",
			}),
		).toBe("screenshot.png");
	});

	it("serializes image and file paths ahead of the prompt, in attach order", () => {
		const context: ContextAttachment[] = [
			{kind: "image", path: "/cache/attachments/a.png", name: "a.png"},
			{kind: "file", path: "/cache/attachments/b.md", name: "notes.md"},
		];

		expect(composePrompt("What is wrong here?", context, [])).toBe(
			["/cache/attachments/a.png", "@/cache/attachments/b.md", "What is wrong here?"].join("\n\n"),
		);
	});
});
