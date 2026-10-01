import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	formatDiffScope,
	parseDiffScope,
	SessionDiffFileResponseSchema,
	SessionDiffResponseSchema,
	SessionDiffScopesResponseSchema,
	sessionDiffFileQueryOptions,
	sessionDiffQueryOptions,
	sessionDiffScopesQueryOptions,
} from "../src/lib/api/session-diff";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {parseJsonlRecord, type JsonlRecord} from "../src/lib/schemas";
import {buildScopeDiff, listScopes} from "../src/lib/session-diff";
import {
	handleSessionDiffRequest,
	handleSessionDiffScopesRequest,
	type SessionDiffHandlerDependencies,
} from "../src/lib/session-diff-handler";
import {runGit} from "./git-fixture";

const SESSION_ID = "session-diff-100";
const LARGE_LINE_COUNT = 2100;

let db: AppDb;
let repository: string;
let commitCounter = 0;

function git(...arguments_: string[]): string {
	commitCounter += 1;
	const date = `2026-01-01T00:00:${String(commitCounter % 60).padStart(2, "0")}Z`;
	return runGit(repository, arguments_, {env: {GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date}});
}

function write(path: string, content: string): void {
	writeFileSync(join(repository, path), content);
}

function insertSession(cwd: string | null): void {
	db.index
		.insert(schema.projects)
		.values({id: "project-diff-100", name: "example", projectPath: "/example", updatedAt: 0})
		.run();
	db.index
		.insert(schema.sessions)
		.values({
			id: SESSION_ID,
			projectId: "project-diff-100",
			title: "Diff example",
			firstPrompt: null,
			summary: null,
			customTitle: null,
			messageCount: 4,
			gitBranch: "feature",
			cwd,
			isSidechain: 0,
			createdAt: 946_598_400_000,
			mtimeMs: 946_684_800_000,
			filePath: `/transcripts/${SESSION_ID}.jsonl`,
		})
		.run();
}

function record(value: Record<string, unknown>): JsonlRecord {
	const parsed = parseJsonlRecord(JSON.stringify(value));
	if (parsed === null) throw new Error(`Invalid JSONL fixture: ${JSON.stringify(value)}`);
	return parsed;
}

function userPrompt(uuid: string, text: string): JsonlRecord {
	return record({
		type: "user",
		uuid,
		parentUuid: null,
		sessionId: SESSION_ID,
		timestamp: "2026-09-29T00:00:00.000Z",
		message: {role: "user", content: text},
	});
}

function writeResult(uuid: string, filePath: string, content: string): JsonlRecord {
	return record({
		type: "user",
		uuid,
		parentUuid: `assistant-${uuid}`,
		sessionId: SESSION_ID,
		timestamp: "2026-09-29T00:00:00.000Z",
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: `toolu_${uuid}`, content: "ok"}],
		},
		toolUseResult: {type: "create", filePath, content, structuredPatch: [], originalFile: null},
		sourceToolAssistantUUID: `assistant-${uuid}`,
	});
}

function sessionRecords(cwd: string): JsonlRecord[] {
	return [
		userPrompt("prompt-1", "Add notes"),
		writeResult("result-1", join(cwd, "notes.md"), "first\nsecond\n"),
		userPrompt("prompt-2", "Add todo"),
		writeResult("result-2", join(cwd, "todo.md"), "only\n"),
	];
}

function dependencies(overrides: Partial<SessionDiffHandlerDependencies> = {}): SessionDiffHandlerDependencies {
	return {
		index: db.index,
		resolveDirectory: async (cwd) => cwd,
		listScopes: (cwd) => listScopes(cwd),
		buildScopeDiff: (cwd, scope, options) => buildScopeDiff(cwd, scope, options),
		readRecords: async () => sessionRecords(repository),
		...overrides,
	};
}

function query(parameters: Record<string, string>): URLSearchParams {
	return new URLSearchParams(parameters);
}

async function diffBody(response: Response) {
	return SessionDiffResponseSchema.parse(await response.json());
}

beforeEach(() => {
	repository = mkdtempSync(join(tmpdir(), "api-session-diff-test-"));
	commitCounter = 0;
	db = openTestDb();

	git("init", "--initial-branch=main");
	git("config", "user.email", "alice@example.com");
	git("config", "user.name", "Alice");
	write("keep.txt", "one\ntwo\n");
	git("add", ".");
	git("commit", "--message", "Initial commit.");
	git("switch", "--create", "feature");
	write("keep.txt", "one\nTWO\n");
	git("add", ".");
	git("commit", "--message", "Edit keep.");
});

afterEach(() => {
	db.close();
	rmSync(repository, {recursive: true, force: true});
});

describe("parseDiffScope / formatDiffScope", () => {
	it("round-trips every scope form", () => {
		const scopes = [
			"branch",
			"uncommitted",
			"commit:0123456789abcdef0123456789abcdef01234567",
			"session",
			"turn:prompt-1",
		];
		expect(
			scopes.map((scope) => {
				const parsed = parseDiffScope(scope);
				return parsed === null ? null : formatDiffScope(parsed);
			}),
		).toStrictEqual(scopes);
	});

	it("rejects malformed scopes", () => {
		expect(["", "commit:", "commit:--output=x", "turn:", "everything"].map(parseDiffScope)).toStrictEqual([
			null,
			null,
			null,
			null,
			null,
		]);
	});
});

describe("handleSessionDiffRequest", () => {
	it("returns 404 for an unknown session", async () => {
		const response = await handleSessionDiffRequest("missing", query({}), dependencies());

		expect(response.status).toBe(404);
		expect(await response.json()).toStrictEqual({error: "Session not found"});
	});

	it("returns 422 when the session has no working directory", async () => {
		insertSession(null);

		const response = await handleSessionDiffRequest(SESSION_ID, query({}), dependencies());

		expect(response.status).toBe(422);
		expect(await response.json()).toStrictEqual({error: "Session has no working directory"});
	});

	it("returns 400 for an invalid scope or whitespace flag", async () => {
		insertSession(repository);

		const badScope = await handleSessionDiffRequest(SESSION_ID, query({scope: "everything"}), dependencies());
		const badWhitespace = await handleSessionDiffRequest(SESSION_ID, query({ws: "yes"}), dependencies());

		expect([badScope.status, badWhitespace.status]).toStrictEqual([400, 400]);
	});

	it("defaults to the branch scope with file list, stats, and patches", async () => {
		insertSession(repository);

		const body = await diffBody(await handleSessionDiffRequest(SESSION_ID, query({}), dependencies()));

		expect(body).toStrictEqual({
			scope: "branch",
			source: "git",
			stats: {files: 1, additions: 1, deletions: 1},
			files: [
				{
					path: "keep.txt",
					status: "modified",
					additions: 1,
					deletions: 1,
					binary: false,
					patchLineCount: 8,
					patch: expect.stringMatching(
						/^diff --git a\/keep\.txt b\/keep\.txt\nindex [0-9a-f]+\.\.[0-9a-f]+ 100644\n--- a\/keep\.txt\n\+\+\+ b\/keep\.txt\n@@ -1,2 \+1,2 @@\n one\n-two\n\+TWO\n$/,
					),
				},
			],
		});
	});

	it("round-trips a commit scope and honours the whitespace flag", async () => {
		write("keep.txt", "one\nTWO  \n");
		write("added.txt", "added\n");
		git("add", ".");
		git("commit", "--message", "Whitespace and add.");
		const sha = git("rev-parse", "HEAD");
		insertSession(repository);

		const withWhitespace = await diffBody(
			await handleSessionDiffRequest(SESSION_ID, query({scope: `commit:${sha}`}), dependencies()),
		);
		const withoutWhitespace = await diffBody(
			await handleSessionDiffRequest(SESSION_ID, query({scope: `commit:${sha}`, ws: "1"}), dependencies()),
		);

		expect([
			withWhitespace.scope,
			withWhitespace.files.map((file) => file.path),
			withoutWhitespace.scope,
			withoutWhitespace.files.map((file) => file.path),
		]).toStrictEqual([`commit:${sha}`, ["added.txt", "keep.txt"], `commit:${sha}`, ["added.txt"]]);
	});

	it("returns 404 for a commit that does not exist", async () => {
		insertSession(repository);

		const response = await handleSessionDiffRequest(
			SESSION_ID,
			query({scope: `commit:${"f".repeat(40)}`}),
			dependencies(),
		);

		expect(response.status).toBe(404);
	});

	it("falls back to session edits when the repository is gone", async () => {
		insertSession(repository);

		const body = await diffBody(
			await handleSessionDiffRequest(
				SESSION_ID,
				query({scope: "branch"}),
				dependencies({resolveDirectory: async () => null}),
			),
		);

		expect(body).toStrictEqual({
			scope: "session",
			source: "session-edits",
			stats: {files: 2, additions: 3, deletions: 0},
			files: [
				{
					path: "notes.md",
					status: "added",
					additions: 2,
					deletions: 0,
					binary: false,
					patchLineCount: expect.any(Number),
					patch: expect.stringContaining("+second"),
				},
				{
					path: "todo.md",
					status: "added",
					additions: 1,
					deletions: 0,
					binary: false,
					patchLineCount: expect.any(Number),
					patch: expect.stringContaining("+only"),
				},
			],
		});
	});

	it("restricts a turn scope to that turn's edits", async () => {
		insertSession(repository);

		const body = await diffBody(
			await handleSessionDiffRequest(SESSION_ID, query({scope: "turn:prompt-2"}), dependencies()),
		);

		expect([body.scope, body.source, body.files.map((file) => file.path)]).toStrictEqual([
			"turn:prompt-2",
			"session-edits",
			["todo.md"],
		]);
	});

	it("returns 404 for an unknown turn", async () => {
		insertSession(repository);

		const response = await handleSessionDiffRequest(SESSION_ID, query({scope: "turn:nope"}), dependencies());

		expect(response.status).toBe(404);
	});

	it("omits large patches and serves them lazily by file", async () => {
		write("large.txt", Array.from({length: LARGE_LINE_COUNT}, (_, i) => `line ${i}`).join("\n"));
		insertSession(repository);

		const list = await diffBody(
			await handleSessionDiffRequest(SESSION_ID, query({scope: "branch"}), dependencies()),
		);
		const lazyResponse = await handleSessionDiffRequest(
			SESSION_ID,
			query({scope: "branch", file: "large.txt"}),
			dependencies(),
		);
		const lazy = SessionDiffFileResponseSchema.parse(await lazyResponse.json());
		const missing = await handleSessionDiffRequest(
			SESSION_ID,
			query({scope: "branch", file: "nope.txt"}),
			dependencies(),
		);

		const large = list.files.find((file) => file.path === "large.txt");
		expect([
			large?.patch,
			large?.additions,
			lazy.scope,
			lazy.file.path,
			lazy.file.patch?.split("\n").filter((line) => line.startsWith("+line ")).length,
			lazy.file.patchLineCount,
			missing.status,
		]).toStrictEqual([null, LARGE_LINE_COUNT, "branch", "large.txt", LARGE_LINE_COUNT, large?.patchLineCount, 404]);
	});
});

describe("handleSessionDiffScopesRequest", () => {
	it("returns 404 for an unknown session", async () => {
		const response = await handleSessionDiffScopesRequest("missing", dependencies());

		expect(response.status).toBe(404);
	});

	it("returns 422 when the session has no working directory", async () => {
		insertSession(null);

		const response = await handleSessionDiffScopesRequest(SESSION_ID, dependencies());

		expect(response.status).toBe(422);
	});

	it("lists git scopes for the session checkout", async () => {
		write("untracked.txt", "fresh\n");
		insertSession(repository);

		const body = SessionDiffScopesResponseSchema.parse(
			await (await handleSessionDiffScopesRequest(SESSION_ID, dependencies())).json(),
		);

		expect(body).toStrictEqual({
			kind: "git",
			base: "main",
			baseRef: "main",
			mergeBase: git("merge-base", "main", "HEAD"),
			head: "feature",
			uncommittedAvailable: true,
			commits: [
				{
					sha: git("rev-parse", "HEAD"),
					shortSha: git("rev-parse", "--short", "HEAD"),
					subject: "Edit keep.",
					author: "Alice",
					date: expect.stringMatching(/^2026-01-01T00:00:\d\d/),
				},
			],
			totalCommits: 1,
		});
	});

	it("reports no-git when the repository is gone", async () => {
		insertSession(repository);

		const response = await handleSessionDiffScopesRequest(
			SESSION_ID,
			dependencies({resolveDirectory: async () => null}),
		);

		expect(await response.json()).toStrictEqual({kind: "no-git"});
	});
});

describe("session diff query options", () => {
	it("keys on session, scope, whitespace flag, and file", () => {
		expect([
			sessionDiffQueryOptions(SESSION_ID, "turn:prompt-1").queryKey,
			sessionDiffQueryOptions(SESSION_ID, "branch", {hideWhitespace: true}).queryKey,
			sessionDiffFileQueryOptions(SESSION_ID, "branch", "src/a.ts").queryKey,
			sessionDiffScopesQueryOptions(SESSION_ID).queryKey,
		]).toStrictEqual([
			["sessions", SESSION_ID, "diff", "turn:prompt-1", false],
			["sessions", SESSION_ID, "diff", "branch", true],
			["sessions", SESSION_ID, "diff", "branch", false, "file", "src/a.ts"],
			["sessions", SESSION_ID, "diff", "scopes"],
		]);
	});
});
