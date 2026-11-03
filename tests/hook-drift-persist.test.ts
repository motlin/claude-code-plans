import {afterEach, describe, expect, it} from "vite-plus/test";
import {HookEventEnvelope} from "../src/lib/hook-events";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {hookSchemaDrift} from "../src/lib/db/schema";
import {persistDrift} from "../src/routes/api/hook";

function promptBody(sessionId: string, prompt: string, extra: Record<string, unknown>): Record<string, unknown> {
	return {
		session_id: sessionId,
		transcript_path: `/tmp/test/${sessionId}.jsonl`,
		cwd: "/tmp/test",
		hook_event_name: "UserPromptSubmit",
		prompt,
		...extra,
	};
}

function record(db: AppDb, body: Record<string, unknown>): number {
	const result = HookEventEnvelope.safeParse(body);
	if (result.success) throw new Error("Expected the fixture to fail schema validation");
	return persistDrift(db.index, "UserPromptSubmit", JSON.stringify(body), result.error);
}

describe("persistDrift", () => {
	let db: AppDb | undefined;
	afterEach(() => {
		db?.close();
	});

	it("collapses different bodies with the same drift onto one row", () => {
		db = openTestDb();
		const first = promptBody("session-1", "first prompt", {new_field: "a"});
		const second = promptBody("session-2", "second prompt", {new_field: "b"});

		expect([record(db, first), record(db, second)]).toStrictEqual([1, 2]);

		const rows = db.index
			.select({
				hookEventName: hookSchemaDrift.hookEventName,
				rawBody: hookSchemaDrift.rawBody,
				count: hookSchemaDrift.count,
			})
			.from(hookSchemaDrift)
			.all();
		expect(rows).toStrictEqual([{hookEventName: "UserPromptSubmit", rawBody: JSON.stringify(first), count: 2}]);
	});

	it("keeps a separate row for a different drift on the same event", () => {
		db = openTestDb();

		expect([
			record(db, promptBody("session-1", "one", {new_field: "a"})),
			record(db, promptBody("session-2", "two", {other_field: "b"})),
		]).toStrictEqual([1, 1]);

		const counts = db.index.select({count: hookSchemaDrift.count}).from(hookSchemaDrift).all();
		expect(counts).toStrictEqual([{count: 1}, {count: 1}]);
	});
});
