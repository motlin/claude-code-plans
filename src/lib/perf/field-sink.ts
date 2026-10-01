// Server sink for field journey samples (plan .llm/perf/measurement-plan.md §4.5, §7 decision 3). The client in
// ./journey.ts beacons `{samples: [...]}` to POST /api/perf; each valid batch is appended as JSONL to
// `<cacheDir>/perf/field-YYYY-MM-DD.jsonl` (the app's own cache dir, never the databases) and files older than the
// retention window are pruned on write.

import {appendFileSync, mkdirSync, readdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";
import {rejectCrossSite} from "../same-origin-guard";
import type {JourneySample} from "./journey";

const FIELD_LOG_RETENTION_DAYS = 30;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SAMPLES_PER_BATCH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const FIELD_LOG_PATTERN = /^field-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const ResourceSampleSchema = z
	.object({
		name: z.string(),
		initiatorType: z.string(),
		startTime: z.number(),
		duration: z.number(),
		requestStart: z.number(),
		responseStart: z.number(),
		responseEnd: z.number(),
		transferSize: z.number(),
		serverTiming: z.array(z.object({name: z.string(), duration: z.number(), description: z.string()}).strict()),
	})
	.strict();

const LongAnimationFrameSampleSchema = z
	.object({
		startTime: z.number(),
		duration: z.number(),
		blockingDuration: z.number(),
		scripts: z.array(
			z
				.object({
					invoker: z.string(),
					sourceURL: z.string(),
					sourceFunctionName: z.string(),
					duration: z.number(),
				})
				.strict(),
		),
	})
	.strict();

const LayoutShiftSampleSchema = z
	.object({startTime: z.number(), value: z.number(), hadRecentInput: z.boolean()})
	.strict();

const EventTimingSampleSchema = z
	.object({
		name: z.string(),
		startTime: z.number(),
		duration: z.number(),
		processingStart: z.number(),
		processingEnd: z.number(),
		interactionId: z.number(),
	})
	.strict();

export const JourneySampleSchema = z
	.object({
		journey: z.string(),
		trigger: z.string(),
		start: z.number(),
		end: z.number(),
		duration: z.number(),
		endSource: z.enum(["element-timing", "event-timing", "raf"]),
		route: z.string(),
		sizeBucket: z.enum(["S", "M", "L"]).exactOptional(),
		prefetchHit: z.boolean().exactOptional(),
		buildSha: z.string(),
		mode: z.enum(["dev", "prod"]),
		origin: z.enum(["localhost", "remote"]),
		formFactor: z.enum(["phone", "desktop"]),
		hardwareConcurrency: z.number(),
		resources: z.array(ResourceSampleSchema),
		longAnimationFrames: z.array(LongAnimationFrameSampleSchema),
		layoutShifts: z.array(LayoutShiftSampleSchema),
		cls: z.number(),
		events: z.array(EventTimingSampleSchema),
	})
	.strict();

const PerfBeaconBatchSchema = z
	.object({samples: z.array(JourneySampleSchema).min(1).max(MAX_SAMPLES_PER_BATCH)})
	.strict();

// Keeps the server schema and the client sample type in lockstep: either drifting is a type error.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const sampleSchemaMatchesClientType: Equal<z.infer<typeof JourneySampleSchema>, JourneySample> = true;
void sampleSchemaMatchesClientType;

export interface PerfSinkOptions {
	/** The server's cache dir, `$XDG_CACHE_HOME/claude-code-plans`. */
	cacheDir: string;
	now?: () => Date;
	/** Echoes each appended sample to the server log; defaults to `CCB_PERF_LOG=1`. */
	echo?: boolean;
}

function utcDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function pruneFieldLogs(perfDir: string, now: Date): void {
	const today = Date.parse(utcDay(now));
	let names: string[];
	try {
		names = readdirSync(perfDir);
	} catch {
		return;
	}
	for (const name of names) {
		const day = FIELD_LOG_PATTERN.exec(name)?.[1];
		if (day === undefined) continue;
		if ((today - Date.parse(day)) / DAY_MS > FIELD_LOG_RETENTION_DAYS) {
			rmSync(join(perfDir, name), {force: true});
		}
	}
}

function badRequest(error: string): Response {
	return Response.json({error}, {status: 400});
}

export async function handlePerfBeacon(request: Request, options: PerfSinkOptions): Promise<Response> {
	const rejection = rejectCrossSite(request);
	if (rejection) return rejection;

	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return Response.json({error: "Payload too large"}, {status: 413});

	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return badRequest("Invalid JSON");
	}
	const parsed = PerfBeaconBatchSchema.safeParse(json);
	if (!parsed.success) return badRequest(z.prettifyError(parsed.error));

	const now = options.now?.() ?? new Date();
	const perfDir = join(options.cacheDir, "perf");
	mkdirSync(perfDir, {recursive: true});
	const lines = parsed.data.samples.map((sample) => `${JSON.stringify(sample)}\n`).join("");
	appendFileSync(join(perfDir, `field-${utcDay(now)}.jsonl`), lines);
	pruneFieldLogs(perfDir, now);
	if (options.echo ?? process.env["CCB_PERF_LOG"] === "1") {
		for (const sample of parsed.data.samples) console.log(JSON.stringify({perf: "field", ...sample}));
	}

	return new Response(null, {status: 204});
}
