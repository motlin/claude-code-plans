import {describe, expect, it} from "vite-plus/test";
import {z} from "zod";
import {HookEventEnvelope} from "../src/lib/hook-events";
import {toLenient} from "../src/lib/lenient-schema";
import {JsonlRecordSchema as RuntimeJsonlRecordSchema} from "../src/lib/runtime-schemas";
import {RuntimeHookEventEnvelope} from "../src/routes/api/hook";
import {JsonlRecordSchema} from "../src/lib/schemas";
import {jsonlRecordFixtures} from "./fixtures/jsonl-records";

const driftedUserRecord = {
	type: "user",
	uuid: "11111111-1111-1111-1111-111111111111",
	parentUuid: null,
	sessionId: "22222222-2222-2222-2222-222222222222",
	timestamp: "2026-10-22T12:00:00.000Z",
	cwd: "/tmp/project",
	version: "9.9.9",
	userType: "external",
	isSidechain: false,
	message: {role: "user", content: "hello", futureMessageKey: 1},
	promptSource: "brand_new_source",
	futureRecordKey: {nested: true},
};

describe("runtime vs strict JSONL schema", () => {
	it("strict form rejects an extra key and an unknown enum value", () => {
		const result = JsonlRecordSchema.safeParse(driftedUserRecord);
		expect(result.success).toBe(false);
		const issues = result.error?.issues.map((issue) => ({code: issue.code, path: issue.path})) ?? [];
		expect(issues).toEqual([
			{code: "unrecognized_keys", path: ["message"]},
			{code: "invalid_value", path: ["promptSource"]},
			{code: "unrecognized_keys", path: []},
		]);
	});

	it("runtime form keeps the record, strips unknown keys, and passes the unknown enum value through", () => {
		const result = RuntimeJsonlRecordSchema.safeParse(driftedUserRecord);
		expect(result.error).toBeUndefined();
		const {futureRecordKey: _extra, message: _message, ...rest} = driftedUserRecord;
		expect(result.data).toEqual({...rest, message: {role: "user", content: "hello"}});
	});

	it("runtime form keeps id-keyed classifier artifacts, stripping unknown share keys and opening share enums", () => {
		const fixture = jsonlRecordFixtures["api-request"];
		const [safeguard] = fixture.params.safeguards;
		const classifierContext = safeguard!.classifier_context;
		const share = {
			mode: "owner",
			is_shared_live: false,
			role: "owner",
			probed: true,
			probe_current_account: true,
			type_lock: false,
			live_paths: [],
			capabilities: {db: {}},
			grant_observed: true,
		};
		const withShare = (value: Record<string, unknown>) => ({
			...fixture,
			params: {
				...fixture.params,
				safeguards: [
					{
						...safeguard!,
						classifier_context: {
							...classifierContext,
							artifacts: {...classifierContext.artifacts, by_slug: {"artifact-alice": {share: value}}},
						},
					},
				],
			},
		});
		const result = RuntimeJsonlRecordSchema.safeParse(withShare({...share, role: "writer", futureShareKey: 1}));
		expect(result.error).toBeUndefined();
		expect(result.data).toEqual(withShare({...share, role: "writer"}));
	});

	it("runtime form keeps history-suppression records with an unknown cause and strips unknown keys", () => {
		const record = {
			type: "history-suppression",
			sessionId: "s1",
			cause: "future_cause",
			ts: "2026-10-23T00:27:52.126Z",
		};
		const result = RuntimeJsonlRecordSchema.safeParse({...record, futureKey: 1});
		expect(result.error).toBeUndefined();
		expect(result.data).toEqual(record);
	});

	it("runtime form keeps structured_output attachment data verbatim, including caller-defined keys", () => {
		const record = {
			...jsonlRecordFixtures.attachment,
			attachment: {
				type: "structured_output",
				toolUseID: "toolu_1",
				data: {summary: "done", nested: {futureKey: [1, "two", null]}},
			},
		};
		const result = RuntimeJsonlRecordSchema.safeParse(record);
		expect(result.error).toBeUndefined();
		expect(result.data).toEqual(record);
	});

	it("runtime form still rejects an unknown record type", () => {
		const result = RuntimeJsonlRecordSchema.safeParse({...driftedUserRecord, type: "brand-new-record"});
		expect(result.success).toBe(false);
	});
});

describe("toLenient", () => {
	const Kind = z.enum(["a", "b"]);
	const Strict = z
		.discriminatedUnion("type", [
			z.object({type: z.literal("one"), kind: Kind, tags: z.record(Kind, z.number()).optional()}).strict(),
			z.object({type: z.literal("two"), items: z.array(z.object({n: z.number()}).strict())}).strict(),
		])
		.refine((value) => value.type !== "two" || value.items.length < 3, "too many items");
	const Lenient = toLenient(Strict);

	it("keeps discriminators closed and refinements in force", () => {
		expect(Lenient.safeParse({type: "three"}).success).toBe(false);
		expect(Lenient.safeParse({type: "two", items: [{n: 1}, {n: 2}, {n: 3}]}).success).toBe(false);
	});

	it("opens nested objects, enums, and enum-keyed records", () => {
		expect(Lenient.parse({type: "one", kind: "c", tags: {z: 1}, extra: true})).toEqual({
			type: "one",
			kind: "c",
			tags: {z: 1},
		});
		expect(Lenient.parse({type: "two", items: [{n: 1, extra: 2}]})).toEqual({type: "two", items: [{n: 1}]});
	});

	it("handles recursive lazy schemas", () => {
		type Tree = {name: string; children: Tree[]};
		const TreeSchema: z.ZodType<Tree> = z.lazy(() =>
			z.object({name: z.string(), children: z.array(TreeSchema)}).strict(),
		);
		expect(toLenient(TreeSchema).parse({name: "r", x: 1, children: [{name: "c", y: 2, children: []}]})).toEqual({
			name: "r",
			children: [{name: "c", children: []}],
		});
	});

	it("leaves the strict source untouched", () => {
		expect(Strict.safeParse({type: "one", kind: "c"}).success).toBe(false);
	});
});

describe("runtime vs strict hook envelope", () => {
	const drifted = {
		session_id: "s",
		transcript_path: "/tmp/t.jsonl",
		cwd: "/tmp",
		hook_event_name: "PreCompact",
		trigger: "brand_new_trigger",
		future_hook_key: 1,
	};

	it("strict rejects the drift and the runtime twin accepts it", () => {
		expect(HookEventEnvelope.safeParse(drifted).success).toBe(false);
		const {future_hook_key: _extra, ...known} = drifted;
		expect(RuntimeHookEventEnvelope.parse(drifted)).toEqual(known);
	});
});
