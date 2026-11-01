import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "vite-plus/test";
import {readPreviousAsset} from "../src/lib/previous-assets";

const root = mkdtempSync(join(tmpdir(), "previous-assets-"));
const dir = join(root, "previous-assets");
mkdirSync(dir);
writeFileSync(join(dir, "tool-approval-notify-tip-PCUCVhl8.js"), "export const tip = 1;");
writeFileSync(join(dir, "styles-ABC123.css"), "body{}");
writeFileSync(join(root, "secret.js"), "nope");

afterAll(() => {
	rmSync(root, {recursive: true, force: true});
});

async function read(pathname: string) {
	const asset = await readPreviousAsset(dir, pathname);
	return asset === null ? null : {body: asset.body.toString("utf8"), headers: asset.headers};
}

describe("readPreviousAsset", () => {
	it("serves a hashed chunk from the previous build as immutable JavaScript", async () => {
		expect(await read("/assets/tool-approval-notify-tip-PCUCVhl8.js")).toStrictEqual({
			body: "export const tip = 1;",
			headers: {
				"Cache-Control": "public, max-age=31536000, immutable",
				"Content-Type": "text/javascript; charset=utf-8",
			},
		});
	});

	it("serves previous stylesheets with their type", async () => {
		expect((await read("/assets/styles-ABC123.css"))?.headers["Content-Type"]).toBe("text/css; charset=utf-8");
	});

	it("returns null for missing, nested, traversing or out-of-prefix paths", async () => {
		expect(
			await Promise.all(
				[
					"/assets/missing-XYZ.js",
					"/assets/../secret.js",
					"/assets/%2e%2e%2fsecret.js",
					"/assets/sub/file.js",
					"/assets/.hidden",
					"/other/tool-approval-notify-tip-PCUCVhl8.js",
				].map(read),
			),
		).toStrictEqual([null, null, null, null, null, null]);
	});

	it("returns null when there is no previous build", async () => {
		expect(await readPreviousAsset(join(root, "absent"), "/assets/styles-ABC123.css")).toBeNull();
	});
});
