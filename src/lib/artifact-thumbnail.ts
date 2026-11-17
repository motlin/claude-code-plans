import {readdirSync, statSync} from "node:fs";
import {mkdir, readFile, rename, rm} from "node:fs/promises";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {isArtifactId, resolveArtifactSource} from "./artifact-source";
import {isThumbnailSourcePath} from "./artifact-source-paths";
import type * as schema from "./db/schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

export type ThumbnailScheme = "light" | "dark";

/**
 * Upstream's thumbnails are server-made screenshots that local transcripts never carry, so the local server
 * screenshots the artifact's own source instead and keeps the PNG here, where it outlives a scratchpad source.
 */
const THUMBS_DIR = "artifact-thumbs";

const THUMB_FILE_PATTERN = /^(?<id>[A-Za-z0-9-]+)-(?<version>\d+)-(?<scheme>light|dark)\.png$/;

/** The cached screenshot of one artifact source version, `<cacheDir>/artifact-thumbs/<id>-<version>-<scheme>.png`. */
export function thumbnailCachePath(
	cacheDir: string,
	id: string,
	version: number,
	scheme: ThumbnailScheme = "light",
): string
{
	return join(cacheDir, THUMBS_DIR, `${id}-${version}-${scheme}.png`);
}

/** A source's thumbnail version: its mtime in whole ms. */
export function thumbnailVersion(mtimeMs: number): number
{
	return Math.trunc(mtimeMs);
}

/** The newest cached light thumbnail version of every artifact that has one. */
export function cachedThumbnailVersions(cacheDir: string): Map<string, number>
{
	const versions = new Map<string, number>();
	let names: string[];
	try
	{
		names = readdirSync(join(cacheDir, THUMBS_DIR));
	}
	catch
	{
		return versions;
	}
	for (const name of names)
	{
		const groups = THUMB_FILE_PATTERN.exec(name)?.groups;
		if (groups?.["scheme"] !== "light") continue;
		const id = groups["id"] ?? "";
		const version = Number(groups["version"]);
		if (version > (versions.get(id) ?? -1)) versions.set(id, version);
	}
	return versions;
}

/** Writes a PNG screenshot of `sourcePath` to `out`; false when no capture could be made. */
export type ThumbnailCapturer = (input: {sourcePath: string; out: string; scheme: ThumbnailScheme}) => Promise<boolean>;

/** Upstream's Docs covers crop a 1005/630 screenshot, the shape of its server-made thumbnails. */
const VIEWPORT =
{
	width: 1005,
	height: 630,
} as const;
const CAPTURE_TIMEOUT_MS = 10_000;
const SETTLE_MS = 500;
const MAX_CONCURRENT_CAPTURES = 2;

let running = 0;
const waiting: (() => void)[] = [];
const inFlight = new Map<string, Promise<boolean>>();
let browserMissingLogged = false;

async function withCaptureSlot<T>(work: () => Promise<T>): Promise<T>
{
	if (running >= MAX_CONCURRENT_CAPTURES)
		await new Promise<void>((resolve) =>
		{
			waiting.push(resolve);
		});
	running++;
	try
	{
		return await work();
	}
	finally
	{
		running--;
		waiting.shift()?.();
	}
}

async function screenshotSource({sourcePath, out, scheme}: Parameters<ThumbnailCapturer>[0]): Promise<boolean>
{
	let chromium: typeof import("playwright").chromium;
	try
	{
		({chromium} = await import("playwright"));
	}
	catch (error)
	{
		if (!browserMissingLogged)
			console.warn("[artifact-thumbnail] playwright is unavailable; covers stay blank:", error);
		browserMissingLogged = true;
		return false;
	}
	let browser: Awaited<ReturnType<typeof chromium.launch>>;
	try
	{
		browser = await chromium.launch(
			{
				headless: true,
			},
		);
	}
	catch (error)
	{
		if (!browserMissingLogged)
			console.warn("[artifact-thumbnail] no Chromium to screenshot with; covers stay blank:", error);
		browserMissingLogged = true;
		return false;
	}
	const partial = `${out}.${process.pid}.partial.png`;
	try
	{
		const context = await browser.newContext(
			{
				viewport: VIEWPORT,
				deviceScaleFactor: 1,
				colorScheme: scheme,
				javaScriptEnabled: true,
			},
		);
		// Offline: the page may only read its own file.
		await context.route("**", async (route) =>
			route.request().url().startsWith("file:") ? route.continue() : route.abort(),
		);
		const page = await context.newPage();
		await page.goto(
			pathToFileURL(sourcePath).href,
			{
				waitUntil: "load",
				timeout: CAPTURE_TIMEOUT_MS,
			},
		);
		await page.waitForTimeout(SETTLE_MS);
		await page.screenshot(
			{
				path: partial,
				type: "png",
				timeout: CAPTURE_TIMEOUT_MS,
			},
		);
		await rename(partial, out);
		return true;
	}
	catch (error)
	{
		console.warn(`[artifact-thumbnail] capture failed for ${sourcePath}:`, error);
		await rm(
			partial,
			{
				force: true,
			},
		);
		return false;
	}
	finally
	{
		await browser.close();
	}
}

/** Screenshots a local artifact source with headless Chromium: at most two at once, one per output file. */
export const captureArtifactThumbnail: ThumbnailCapturer = async (input) =>
{
	const pending = inFlight.get(input.out);
	if (pending !== undefined) return pending;
	const capture = withCaptureSlot(async () => screenshotSource(input)).finally(() => inFlight.delete(input.out));
	inFlight.set(input.out, capture);
	return capture;
};

async function dropOlderVersions(cacheDir: string, id: string, version: number): Promise<void>
{
	let names: string[];
	try
	{
		names = readdirSync(join(cacheDir, THUMBS_DIR));
	}
	catch
	{
		return;
	}
	await Promise.all(
		names
			.filter((name) =>
			{
				const groups = THUMB_FILE_PATTERN.exec(name)?.groups;
				return groups?.["id"] === id && Number(groups["version"]) < version;
			})
			.map(async (name) =>
				rm(
					join(cacheDir, THUMBS_DIR, name),
					{
						force: true,
					},
				),
			),
	);
}

function fileExists(path: string): boolean
{
	try
	{
		return statSync(path).isFile();
	}
	catch
	{
		return false;
	}
}

/**
 * Makes sure the current version of an artifact's HTML source has a cached thumbnail, capturing it when missing.
 * Returns nothing useful when the source is gone or isn't HTML.
 */
export async function ensureArtifactThumbnail(
	db: IndexDb,
	id: string,
	{
		cacheDir,
		capture,
	}:
	{
		cacheDir: string;
		capture: ThumbnailCapturer;
	},
): Promise<void>
{
	const sourcePath = resolveArtifactSource(db, id);
	if (sourcePath === null || !isThumbnailSourcePath(sourcePath)) return;
	let version: number;
	try
	{
		version = thumbnailVersion(statSync(sourcePath).mtimeMs);
	}
	catch
	{
		return;
	}
	const out = thumbnailCachePath(cacheDir, id, version);
	if (fileExists(out)) return;
	await mkdir(
		join(cacheDir, THUMBS_DIR),
		{
			recursive: true,
		},
	);
	if (
		await capture(
			{
				sourcePath,
				out,
				scheme: "light",
			},
		)
	)
		await dropOlderVersions(cacheDir, id, version);
}

function notFound(): Response
{
	return new Response(
		"Artifact thumbnail not found",
		{
			status: 404,
			headers:
			{
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "no-store",
			},
		},
	);
}

/**
 * `GET /api/artifacts/:id/thumbnail`: the newest cached screenshot of the artifact's source, capturing the current
 * version first when the source still exists. The list's URL carries the version, so a response never changes.
 */
export async function handleArtifactThumbnailRequest(
	db: IndexDb,
	id: string,
	{
		cacheDir,
		capture = captureArtifactThumbnail,
	}:
	{
		cacheDir: string;
		capture?: ThumbnailCapturer;
	},
): Promise<Response>
{
	if (!isArtifactId(id)) return notFound();
	await ensureArtifactThumbnail(
		db,
		id,
		{
			cacheDir,
			capture,
		},
	);
	const version = cachedThumbnailVersions(cacheDir).get(id);
	if (version === undefined) return notFound();
	let png: Buffer;
	try
	{
		png = await readFile(thumbnailCachePath(cacheDir, id, version));
	}
	catch
	{
		return notFound();
	}
	return new Response(
		new Uint8Array(png),
		{
			status: 200,
			headers:
			{
				"Content-Type": "image/png",
				"Cache-Control": "private, max-age=31536000, immutable",
				"X-Content-Type-Options": "nosniff",
			},
		},
	);
}
