import {writeFile} from "node:fs/promises";
import {mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	cachedThumbnailVersions,
	handleArtifactThumbnailRequest,
	THUMBNAIL_VIEWPORT,
	thumbnailCachePath,
	type ThumbnailCapturer,
} from "../src/lib/artifact-thumbnail";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

const ARTIFACT_ID = "546d3910-4e9a-4730-9e91-62742a47c7c6";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SOURCE_MTIME_S = 1_790_000_000;

let fixtureDirectory: string;
let cacheDir: string;
let db: AppDb;

function seedArtifact(sourcePath: string | null): void
{
	db.index
		.insert(schema.artifacts)
		.values(
			{
				url: `https://claude.ai/code/artifact/${ARTIFACT_ID}`,
				id: ARTIFACT_ID,
				urlKind: "uuid",
				title: "Asap Ladder Queue",
				favicon: null,
				description: null,
				sourcePath,
				version: "1",
				audience: "owner",
				firstSeenAt: 1_000,
				lastPublishedAt: 2_000,
				publishCount: 1,
				lastSessionId: "session-ladder",
				projectId: "-Users-alice-projects-ladder",
			},
		)
		.run();
}

function writeSource(): string
{
	const sourcePath = join(fixtureDirectory, "ladder.html");
	writeFileSync(sourcePath, "<!doctype html><h1>Ladder</h1>");
	utimesSync(sourcePath, SOURCE_MTIME_S, SOURCE_MTIME_S);
	return sourcePath;
}

function seedCache(version: number, capture?: number): void
{
	const path = thumbnailCachePath(cacheDir, ARTIFACT_ID, version, "light", capture);
	mkdirSync(
		join(cacheDir, "artifact-thumbs"),
		{
			recursive: true,
		},
	);
	writeFileSync(path, PNG);
}

async function describeResponse(response: Response)
{
	return {
		status: response.status,
		contentType: response.headers.get("Content-Type"),
		cacheControl: response.headers.get("Cache-Control"),
		nosniff: response.headers.get("X-Content-Type-Options"),
		body: Buffer.from(await response.arrayBuffer()).equals(PNG) ? "png" : "other",
	};
}

const SERVED_PNG =
{
	status: 200,
	contentType: "image/png",
	cacheControl: "private, max-age=31536000, immutable",
	nosniff: "nosniff",
	body: "png",
};

beforeEach(() =>
{
	fixtureDirectory = realpathSync(mkdtempSync(join(tmpdir(), "artifact-thumbnail-test-")));
	cacheDir = join(fixtureDirectory, "cache");
	db = openTestDb();
});

afterEach(() =>
{
	db.close();
	rmSync(
		fixtureDirectory,
		{
			recursive: true,
			force: true,
		},
	);
});

describe("thumbnailCachePath", () =>
{
	it("captures at upstream's 1200x630 thumbnail size", () =>
	{
		expect(THUMBNAIL_VIEWPORT).toStrictEqual(
			{
				width: 1200,
				height: 630,
			},
		);
	});

	it("names a PNG under artifact-thumbs by id, source version, scheme and capture", () =>
	{
		expect([
			thumbnailCachePath("/cache", ARTIFACT_ID, 1_790_000_000_000),
			thumbnailCachePath("/cache", ARTIFACT_ID, 1_790_000_000_000, "dark"),
			thumbnailCachePath("/cache", ARTIFACT_ID, 1_790_000_000_000, "light", 1),
		]).toStrictEqual([
			`/cache/artifact-thumbs/${ARTIFACT_ID}-1790000000000-light.c2.png`,
			`/cache/artifact-thumbs/${ARTIFACT_ID}-1790000000000-dark.c2.png`,
			`/cache/artifact-thumbs/${ARTIFACT_ID}-1790000000000-light.png`,
		]);
	});

	it("lists the newest cached light version per id, newest capture first within a version", () =>
	{
		seedCache(1);
		seedCache(3, 1);
		seedCache(3);
		writeFileSync(thumbnailCachePath(cacheDir, "other-id", 2, "light", 1), PNG);
		writeFileSync(thumbnailCachePath(cacheDir, "other-id", 9, "dark"), PNG);

		expect(cachedThumbnailVersions(cacheDir)).toStrictEqual(
			new Map([
				[
					ARTIFACT_ID,
					{
						version: 3,
						capture: 2,
					},
				],
				[
					"other-id",
					{
						version: 2,
						capture: 1,
					},
				],
			]),
		);
		expect(cachedThumbnailVersions(join(fixtureDirectory, "missing"))).toStrictEqual(new Map());
	});
});

describe("GET /api/artifacts/:id/thumbnail", () =>
{
	it("404s an artifact with no source and no cached thumbnail, without capturing", async () =>
	{
		seedArtifact(join(fixtureDirectory, "gone.html"));
		const capture = vi.fn<ThumbnailCapturer>();

		const response = await handleArtifactThumbnailRequest(
			db.index,
			ARTIFACT_ID,
			{
				cacheDir,
				capture,
			},
		);

		expect(
			{
				status: response.status,
				captures: capture.mock.calls.length,
			},
		).toStrictEqual(
			{
				status: 404,
				captures: 0,
			},
		);
	});

	it("serves the cached PNG of a source that is gone, immutably, even from an older capture", async () =>
	{
		seedArtifact(join(fixtureDirectory, "gone.html"));
		seedCache(1_790_000_000_000, 1);
		const capture = vi.fn<ThumbnailCapturer>();

		expect(
			await describeResponse(
				await handleArtifactThumbnailRequest(
					db.index,
					ARTIFACT_ID,
					{
						cacheDir,
						capture,
					},
				),
			),
		).toStrictEqual(SERVED_PNG);
		expect(capture.mock.calls.length).toBe(0);
	});

	it("captures an existing source once in light, then drops older versions and older captures", async () =>
	{
		const sourcePath = writeSource();
		seedArtifact(sourcePath);
		seedCache(1);
		const version = Math.trunc(statSync(sourcePath).mtimeMs);
		seedCache(version, 1);
		const capture = vi.fn<ThumbnailCapturer>(async ({out}) =>
		{
			await writeFile(out, PNG);
			return true;
		});

		const first = await describeResponse(
			await handleArtifactThumbnailRequest(
				db.index,
				ARTIFACT_ID,
				{
					cacheDir,
					capture,
				},
			),
		);
		await handleArtifactThumbnailRequest(
			db.index,
			ARTIFACT_ID,
			{
				cacheDir,
				capture,
			},
		);

		expect(
			{
				first,
				captures: capture.mock.calls,
				cached: readdirSync(join(cacheDir, "artifact-thumbs")),
			},
		).toStrictEqual(
			{
				first: SERVED_PNG,
				captures: [
					[
						{
							sourcePath,
							out: thumbnailCachePath(cacheDir, ARTIFACT_ID, version),
							scheme: "light",
						},
					],
				],
				cached: [`${ARTIFACT_ID}-${version}-light.c2.png`],
			},
		);
	});

	it("rejects ids outside the artifact id alphabet", async () =>
	{
		const capture = vi.fn<ThumbnailCapturer>();

		const response = await handleArtifactThumbnailRequest(
			db.index,
			"../index",
			{
				cacheDir,
				capture,
			},
		);

		expect(response.status).toBe(404);
	});
});
