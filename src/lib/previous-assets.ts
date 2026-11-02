import {readFile} from "node:fs/promises";
import {extname, join} from "node:path";

// scripts/server.sh copies the previous snapshot's public/assets into each new snapshot's .output/previous-assets,
// so a tab still running the old build can lazily import its hashed chunks after a deploy.

const ASSET_PATH = /^\/assets\/([\w-][\w.-]*)$/;

const CONTENT_TYPES: Record<string, string> =
{
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export interface PreviousAsset
{
	body: Buffer;
	headers: Record<string, string>;
}

/** Reads `/assets/<file>` from the previous build's assets, or null when it isn't there. */
export async function readPreviousAsset(dir: string, pathname: string): Promise<PreviousAsset | null>
{
	const name = ASSET_PATH.exec(pathname)?.[1];
	if (name === undefined) return null;
	try
	{
		const body = await readFile(join(dir, name));
		return {
			body,
			headers:
			{
				"Cache-Control": "public, max-age=31536000, immutable",
				"Content-Type": CONTENT_TYPES[extname(name)] ?? "application/octet-stream",
			},
		};
	}
	catch
	{
		return null;
	}
}
