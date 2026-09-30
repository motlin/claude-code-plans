import {z} from "zod";
import {formatCount} from "./pluralize";
import {toolInputSchemas} from "./tool-input-schemas";

/** Where a routine runs: a session cron, a session wakeup, or a cloud (CCR) trigger. */
export const RoutineKindSchema = z.enum(["cron", "wakeup", "cloud"]);
export type RoutineKind = z.infer<typeof RoutineKindSchema>;

export const RoutineStatusSchema = z.enum(["active", "completed"]);
export type RoutineStatus = z.infer<typeof RoutineStatusSchema>;

/** Upstream's Filter ▸ Schedule choices. */
export const RoutineScheduleFilterSchema = z.enum(["all", "recurring", "one-time"]);
export type RoutineScheduleFilter = z.infer<typeof RoutineScheduleFilterSchema>;

/** Upstream's Filter ▸ Status choices that exist locally. */
export const RoutineStatusFilterSchema = z.enum(["all", "active", "completed"]);
export type RoutineStatusFilter = z.infer<typeof RoutineStatusFilterSchema>;

/** Upstream's Sort choices. */
export const RoutineSortSchema = z.enum(["next-run", "name"]);
export type RoutineSort = z.infer<typeof RoutineSortSchema>;

/** One scheduling tool call found in a transcript. */
export interface ExtractedRoutine {
	toolUseId: string;
	/** The assistant record holding the tool_use, for linking to the call. */
	recordUuid: string | null;
	kind: RoutineKind;
	/** CronCreate job id or RemoteTrigger trigger id. */
	routineId: string | null;
	name: string | null;
	/** Five-field cron expression, in local time. */
	schedule: string | null;
	humanSchedule: string | null;
	delaySeconds: number | null;
	/** Epoch ms of a fixed one-time run (wakeup or cloud run_once_at). */
	runOnceAt: number | null;
	recurring: boolean;
	durable: boolean;
	prompt: string;
	createdAt: number;
	deletedAt: number | null;
}

const CronCreateResultSchema = z.strictObject({
	id: z.string(),
	humanSchedule: z.string(),
	recurring: z.boolean(),
	durable: z.boolean(),
});

const ScheduleWakeupResultSchema = z.strictObject({
	scheduledFor: z.number(),
	clampedDelaySeconds: z.number(),
	wasClamped: z.boolean(),
	stopped: z.boolean().optional(),
	cancelledWakeups: z.number().optional(),
});

const RemoteTriggerResultSchema = z.strictObject({
	status: z.number(),
	json: z.string(),
});

interface PendingCall {
	name: string;
	input: unknown;
	recordUuid: string | null;
	timestamp: number | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function parseTimestamp(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
}

function nonEmpty(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

const TRACKED_TOOLS = new Set(["CronCreate", "CronDelete", "ScheduleWakeup", "RemoteTrigger"]);

/** The created trigger's id and prompt from a RemoteTrigger create response body. */
function parseRemoteTrigger(json: string): {id: string | null; prompt: string | null} {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return {id: null, prompt: null};
	}
	const trigger = asRecord(asRecord(parsed)?.["trigger"]);
	return {
		id: nonEmpty(trigger?.["id"]),
		prompt: nonEmpty(asRecord(trigger?.["derived_state"])?.["prompt"]),
	};
}

/**
 * Collects the routines one transcript scheduled: CronCreate jobs, ScheduleWakeup
 * wakeups and RemoteTrigger (create) cloud routines, pairing each tool_use with the
 * user record that carries its result. CronDelete and ScheduleWakeup `stop` calls
 * mark the routines they cancel.
 */
export class RoutineCollector {
	private readonly pending = new Map<string, PendingCall>();
	private readonly collected: ExtractedRoutine[] = [];

	add(record: unknown): void {
		const obj = asRecord(record);
		if (obj === undefined) return;
		const content = asRecord(obj["message"])?.["content"];
		if (!Array.isArray(content)) return;
		const timestamp = parseTimestamp(obj["timestamp"]);

		for (const rawBlock of content) {
			const block = asRecord(rawBlock);
			if (block === undefined) continue;
			if (obj["type"] === "assistant" && block["type"] === "tool_use") {
				const name = block["name"];
				if (typeof name !== "string" || !TRACKED_TOOLS.has(name)) continue;
				if (typeof block["id"] !== "string") continue;
				this.pending.set(block["id"], {
					name,
					input: block["input"],
					recordUuid: typeof obj["uuid"] === "string" ? obj["uuid"] : null,
					timestamp,
				});
			} else if (obj["type"] === "user" && block["type"] === "tool_result") {
				const toolUseId = block["tool_use_id"];
				if (typeof toolUseId !== "string") continue;
				const call = this.pending.get(toolUseId);
				if (call === undefined) continue;
				this.pending.delete(toolUseId);
				if (block["is_error"] === true) continue;
				const at = call.timestamp ?? timestamp;
				if (at === undefined) continue;
				this.addResult(toolUseId, call, at, obj["toolUseResult"]);
			}
		}
	}

	routines(): ExtractedRoutine[] {
		return this.collected;
	}

	private addResult(toolUseId: string, call: PendingCall, at: number, result: unknown): void {
		const base = {toolUseId, recordUuid: call.recordUuid, createdAt: at, deletedAt: null};
		switch (call.name) {
			case "CronCreate": {
				const input = toolInputSchemas.CronCreate.safeParse(call.input);
				const output = CronCreateResultSchema.safeParse(result);
				if (!input.success || !output.success) return;
				this.collected.push({
					...base,
					kind: "cron",
					routineId: output.data.id,
					name: null,
					schedule: input.data.cron,
					humanSchedule: output.data.humanSchedule,
					delaySeconds: null,
					runOnceAt: null,
					recurring: output.data.recurring,
					durable: output.data.durable,
					prompt: input.data.prompt,
				});
				return;
			}
			case "CronDelete": {
				const input = toolInputSchemas.CronDelete.safeParse(call.input);
				if (!input.success) return;
				const id = input.data.id ?? input.data.cron_id;
				for (const routine of this.collected) {
					if (routine.kind === "cron" && routine.routineId === id && routine.deletedAt === null) {
						routine.deletedAt = at;
					}
				}
				return;
			}
			case "ScheduleWakeup": {
				const input = toolInputSchemas.ScheduleWakeup.safeParse(call.input);
				const output = ScheduleWakeupResultSchema.safeParse(result);
				if (!input.success || !output.success) return;
				if (input.data.stop === true || output.data.stopped === true) {
					for (const routine of this.collected) {
						if (routine.kind === "wakeup" && routine.deletedAt === null) routine.deletedAt = at;
					}
					return;
				}
				if (input.data.noop === true || output.data.scheduledFor <= 0) return;
				this.collected.push({
					...base,
					kind: "wakeup",
					routineId: null,
					name: null,
					schedule: null,
					humanSchedule: null,
					delaySeconds: output.data.clampedDelaySeconds,
					runOnceAt: output.data.scheduledFor,
					recurring: false,
					durable: false,
					prompt: input.data.prompt ?? input.data.reason ?? "",
				});
				return;
			}
			case "RemoteTrigger": {
				const input = toolInputSchemas.RemoteTrigger.safeParse(call.input);
				const output = RemoteTriggerResultSchema.safeParse(result);
				if (!input.success || !output.success || input.data.action !== "create") return;
				if (output.data.status < 200 || output.data.status >= 300) return;
				const body = input.data.body ?? {};
				const trigger = parseRemoteTrigger(output.data.json);
				const cron = nonEmpty(body["cron_expression"]) ?? nonEmpty(body["cron"]);
				const runOnceAt = parseTimestamp(body["run_once_at"]) ?? null;
				this.collected.push({
					...base,
					kind: "cloud",
					routineId: trigger.id,
					name: nonEmpty(body["name"]),
					schedule: cron,
					humanSchedule: null,
					delaySeconds: null,
					runOnceAt,
					recurring: cron !== null && runOnceAt === null,
					durable: true,
					prompt: trigger.prompt ?? nonEmpty(body["name"]) ?? "",
				});
				return;
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Cron schedules
// ---------------------------------------------------------------------------

const CRON_FIELD_RANGES = [
	[0, 59],
	[0, 23],
	[1, 31],
	[1, 12],
	[0, 7],
] as const;

function parseCronField(field: string, min: number, max: number): Set<number> | null {
	const values = new Set<number>();
	for (const part of field.split(",")) {
		const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
		if (match === null) return null;
		const step = match[4] === undefined ? 1 : Number(match[4]);
		let start = min;
		let end = max;
		if (match[1] !== "*") {
			start = Number(match[2]);
			end = match[3] === undefined ? (match[4] === undefined ? start : max) : Number(match[3]);
		}
		if (step < 1 || start < min || end > max || start > end) return null;
		for (let value = start; value <= end; value += step) values.add(value);
	}
	return values;
}

interface ParsedCron {
	minutes: Set<number>;
	hours: Set<number>;
	days: Set<number>;
	months: Set<number>;
	weekdays: Set<number>;
	dayRestricted: boolean;
	weekdayRestricted: boolean;
}

function parseCron(expression: string): ParsedCron | null {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) return null;
	const sets = fields.map((field, index) => {
		const [min, max] = CRON_FIELD_RANGES[index] ?? [0, 0];
		return parseCronField(field, min, max);
	});
	const [minutes, hours, days, months, weekdays] = sets;
	if (!minutes || !hours || !days || !months || !weekdays) return null;
	if (weekdays.has(7)) weekdays.add(0);
	return {
		minutes,
		hours,
		days,
		months,
		weekdays,
		dayRestricted: fields[2] !== "*",
		weekdayRestricted: fields[4] !== "*",
	};
}

function dayMatches(cron: ParsedCron, date: Date): boolean {
	const day = cron.days.has(date.getDate());
	const weekday = cron.weekdays.has(date.getDay());
	// Standard cron: when both day fields are restricted, either may match.
	if (cron.dayRestricted && cron.weekdayRestricted) return day || weekday;
	return day && weekday;
}

const MAX_CRON_SEARCH_DAYS = 366 * 5;

/** The first local minute strictly after `from` that `expression` fires on, or null. */
export function nextCronRun(expression: string, from: number): number | null {
	const cron = parseCron(expression);
	if (cron === null) return null;
	const date = new Date(from);
	date.setSeconds(0, 0);
	date.setMinutes(date.getMinutes() + 1);
	const limit = from + MAX_CRON_SEARCH_DAYS * 24 * 60 * 60 * 1000;
	while (date.getTime() <= limit) {
		if (!cron.months.has(date.getMonth() + 1) || !dayMatches(cron, date)) {
			date.setHours(0, 0, 0, 0);
			date.setDate(date.getDate() + 1);
			continue;
		}
		if (!cron.hours.has(date.getHours())) {
			date.setMinutes(0);
			date.setHours(date.getHours() + 1);
			continue;
		}
		if (!cron.minutes.has(date.getMinutes())) {
			date.setMinutes(date.getMinutes() + 1);
			continue;
		}
		return date.getTime();
	}
	return null;
}

/** When the routine next fires by its schedule alone, or null when it will not fire again. */
export function routineNextRunAt(routine: ExtractedRoutine, now: number): number | null {
	if (routine.recurring) {
		return routine.schedule === null ? null : nextCronRun(routine.schedule, now);
	}
	const once =
		routine.runOnceAt ?? (routine.schedule === null ? null : nextCronRun(routine.schedule, routine.createdAt));
	return once !== null && once > now ? once : null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface LiveSessionCron {
	id: string;
	schedule: string;
	recurring: boolean;
	prompt: string;
}

/** What the hook store knows about a running session's scheduled work. */
export interface LiveSessionRoutines {
	/** The latest Stop hook's `session_crons`, or null before any Stop reported them. */
	sessionCrons: readonly LiveSessionCron[] | null;
	sessionCronsAt: number | null;
}

/**
 * Active while the routine can still fire. Session crons and wakeups die with the
 * Claude process, so a session that is not running means expired; while it runs,
 * the latest Stop `session_crons` is authoritative once it postdates the call.
 * Cloud routines live server-side and only complete when a one-time run passes.
 */
export function routineStatus(
	routine: ExtractedRoutine,
	live: LiveSessionRoutines | undefined,
	now: number,
): RoutineStatus {
	if (routine.deletedAt !== null) return "completed";
	if (routine.kind === "cloud") {
		return routine.recurring || routineNextRunAt(routine, now) !== null ? "active" : "completed";
	}
	if (live === undefined) return "completed";
	if (live.sessionCrons !== null && live.sessionCronsAt !== null && live.sessionCronsAt >= routine.createdAt) {
		const listed = live.sessionCrons.some((cron) =>
			routine.routineId !== null ? cron.id === routine.routineId : cron.prompt === routine.prompt,
		);
		return listed ? "active" : "completed";
	}
	return routineNextRunAt(routine, now) === null ? "completed" : "active";
}

// ---------------------------------------------------------------------------
// Page view: filter, sort, hidden count
// ---------------------------------------------------------------------------

/** The fields the page's filter, sort and search read. */
export interface RoutineRow {
	toolUseId: string;
	name: string | null;
	prompt: string;
	schedule: string | null;
	humanSchedule: string | null;
	recurring: boolean;
	createdAt: number;
	sessionTitle: string | null;
	status: RoutineStatus;
	nextRunAt: number | null;
}

export interface RoutineView {
	search: string;
	schedule: RoutineScheduleFilter;
	status: RoutineStatusFilter;
	sort: RoutineSort;
	includeCompleted: boolean;
}

export const DEFAULT_ROUTINE_VIEW: RoutineView = {
	search: "",
	schedule: "all",
	status: "all",
	sort: "next-run",
	includeCompleted: false,
};

/** A routine's display name: its cloud name, else the first line of its prompt. */
export function routineTitle(routine: Pick<RoutineRow, "name" | "prompt">): string {
	const firstLine = routine.prompt.trim().split("\n")[0]?.trim() ?? "";
	return routine.name ?? (firstLine === "" ? "Scheduled prompt" : firstLine);
}

function matchesSearch(routine: RoutineRow, search: string): boolean {
	const needle = search.trim().toLowerCase();
	if (needle === "") return true;
	return [routine.name, routine.prompt, routine.sessionTitle, routine.schedule, routine.humanSchedule]
		.filter((value): value is string => value !== null)
		.some((value) => value.toLowerCase().includes(needle));
}

/**
 * Apply search and the Schedule/Status filters. Completed routines stay hidden (and
 * counted) unless "Include completed" is on or the Status filter asks for them.
 */
export function filterRoutines<T extends RoutineRow>(
	routines: readonly T[],
	view: Pick<RoutineView, "search" | "schedule" | "status" | "includeCompleted">,
): {visible: T[]; hiddenCompleted: number} {
	const matching = routines.filter(
		(routine) =>
			matchesSearch(routine, view.search) &&
			(view.schedule === "all" || routine.recurring === (view.schedule === "recurring")) &&
			(view.status === "all" || routine.status === view.status),
	);
	if (view.includeCompleted || view.status === "completed") {
		return {visible: matching, hiddenCompleted: 0};
	}
	const visible = matching.filter((routine) => routine.status !== "completed");
	return {visible, hiddenCompleted: matching.length - visible.length};
}

export function sortRoutines<T extends RoutineRow>(routines: readonly T[], sort: RoutineSort): T[] {
	const byName = (a: T, b: T) => routineTitle(a).localeCompare(routineTitle(b), undefined, {sensitivity: "base"});
	if (sort === "name") return [...routines].sort((a, b) => byName(a, b) || b.createdAt - a.createdAt);
	return [...routines].sort((a, b) => {
		if (a.nextRunAt !== b.nextRunAt) {
			if (a.nextRunAt === null) return 1;
			if (b.nextRunAt === null) return -1;
			return a.nextRunAt - b.nextRunAt;
		}
		return b.createdAt - a.createdAt;
	});
}

/** Upstream's centered muted line, e.g. "1 completed routine hidden". */
export function hiddenCompletedText(count: number): string {
	return `${formatCount(count, "completed routine")} hidden`;
}

function sameLocalDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "today at 3:45 PM", "tomorrow at 9:00 AM", or "Oct 5 at 9:00 AM" (with the year when it differs). */
export function formatNextRun(ms: number, now: number): string {
	const date = new Date(ms);
	const today = new Date(now);
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	const time = date.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"}).replace(/\s/g, " ");
	if (sameLocalDay(date, today)) return `today at ${time}`;
	if (sameLocalDay(date, tomorrow)) return `tomorrow at ${time}`;
	const day = date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === today.getFullYear() ? {} : {year: "numeric"}),
	});
	return `${day} at ${time}`;
}
