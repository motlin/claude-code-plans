import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {ARTIFACT_SOURCE_CSP, handleArtifactSourceRequest, isPreviewableSourcePath} from "../src/lib/artifact-source";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

const ARTIFACT_ID = "546d3910-4e9a-4730-9e91-62742a47c7c6";

let fixtureDirectory: string;
let db: AppDb;

function seedArtifact(id: string, sourcePath: string | null): void {
	db.index
		.insert(schema.artifacts)
		.values({
			url: `https://claude.ai/code/artifact/${id}`,
			id,
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
		})
		.run();
}

async function describeResponse(response: Response) {
	return {
		status: response.status,
		contentType: response.headers.get("Content-Type"),
		csp: response.headers.get("Content-Security-Policy"),
		nosniff: response.headers.get("X-Content-Type-Options"),
		cacheControl: response.headers.get("Cache-Control"),
		body: await response.text(),
	};
}

beforeEach(() => {
	fixtureDirectory = realpathSync(mkdtempSync(join(tmpdir(), "api-artifact-source-test-")));
	db = openTestDb();
});

afterEach(() => {
	rmSync(fixtureDirectory, {recursive: true, force: true});
});

describe("isPreviewableSourcePath", () => {
	it("accepts only absolute .html, .htm and .md paths", () => {
		expect(
			[
				"/a/page.html",
				"/a/page.HTM",
				"/a/notes.md",
				"/a/data.json",
				"relative/page.html",
				"/a/page.html.txt",
			].map(isPreviewableSourcePath),
		).toStrictEqual([true, true, true, false, false, false]);
	});
});

describe("GET /api/artifacts/:id/source", () => {
	it("serves the recorded HTML source with sandboxing headers", async () => {
		const sourcePath = join(fixtureDirectory, "ladder.html");
		writeFileSync(sourcePath, "<!doctype html><h1>Ladder</h1>");
		seedArtifact(ARTIFACT_ID, sourcePath);

		expect(await describeResponse(await handleArtifactSourceRequest(db.index, ARTIFACT_ID))).toStrictEqual({
			status: 200,
			contentType: "text/html; charset=utf-8",
			csp: "sandbox allow-scripts; default-src * data: blob: 'unsafe-inline'",
			nosniff: "nosniff",
			cacheControl: "no-store",
			body: "<!doctype html><h1>Ladder</h1>",
		});
		expect(ARTIFACT_SOURCE_CSP).toBe("sandbox allow-scripts; default-src * data: blob: 'unsafe-inline'");
	});

	it("renders a recorded Markdown source as escaped HTML", async () => {
		const sourcePath = join(fixtureDirectory, "notes.md");
		writeFileSync(sourcePath, "# Notes\n\n<script>alert(1)</script>\n");
		seedArtifact(ARTIFACT_ID, sourcePath);

		const response = await describeResponse(await handleArtifactSourceRequest(db.index, ARTIFACT_ID));

		expect({...response, body: response.body.includes("<h1>Notes</h1>")}).toStrictEqual({
			status: 200,
			contentType: "text/html; charset=utf-8",
			csp: ARTIFACT_SOURCE_CSP,
			nosniff: "nosniff",
			cacheControl: "no-store",
			body: true,
		});
		expect(response.body.includes("<script>")).toBe(false);
	});

	it("404s an unknown id", async () => {
		expect((await handleArtifactSourceRequest(db.index, "17b8a2c1-4c41-46bf-b064-a272240be709")).status).toBe(404);
	});

	it("404s when the recorded source is missing, absent or not previewable", async () => {
		const jsonPath = join(fixtureDirectory, "data.json");
		writeFileSync(jsonPath, "{}");
		seedArtifact("aaaaaaaa-0000-4000-8000-000000000001", join(fixtureDirectory, "gone.html"));
		seedArtifact("aaaaaaaa-0000-4000-8000-000000000002", null);
		seedArtifact("aaaaaaaa-0000-4000-8000-000000000003", jsonPath);
		seedArtifact("aaaaaaaa-0000-4000-8000-000000000004", fixtureDirectory + ".html");
		mkdirSync(fixtureDirectory + ".html");

		const statuses = await Promise.all(
			["1", "2", "3", "4"].map(
				async (n) =>
					(await handleArtifactSourceRequest(db.index, `aaaaaaaa-0000-4000-8000-00000000000${n}`)).status,
			),
		);
		rmSync(fixtureDirectory + ".html", {recursive: true, force: true});

		expect(statuses).toStrictEqual([404, 404, 404, 404]);
	});

	it("cannot be steered outside the recorded source", async () => {
		const secretPath = join(fixtureDirectory, "secret.txt");
		writeFileSync(secretPath, "top secret");
		const linkPath = join(fixtureDirectory, "link.html");
		symlinkSync(secretPath, linkPath);
		seedArtifact(ARTIFACT_ID, linkPath);
		seedArtifact("aaaaaaaa-0000-4000-8000-000000000005", `${fixtureDirectory}/../x/../secret.html`);

		const responses = await Promise.all(
			[
				ARTIFACT_ID,
				`../../${secretPath}`,
				`${ARTIFACT_ID}/../../secret.txt`,
				encodeURIComponent(secretPath),
				"aaaaaaaa-0000-4000-8000-000000000005",
			].map(async (id) => describeResponse(await handleArtifactSourceRequest(db.index, id))),
		);

		expect(responses.map(({status, body}) => ({status, leaked: body.includes("secret")}))).toStrictEqual([
			{status: 404, leaked: false},
			{status: 404, leaked: false},
			{status: 404, leaked: false},
			{status: 404, leaked: false},
			{status: 404, leaked: false},
		]);
	});
});
