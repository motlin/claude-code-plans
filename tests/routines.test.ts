import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import type {Routine} from "../src/lib/api/routines";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {indexJsonlFile} from "../src/lib/db/indexer";
import {getRoutines} from "../src/lib/db/routine-index";
import * as schema from "../src/lib/db/schema";
import {
	DEFAULT_ROUTINE_VIEW,
	filterRoutines,
	formatNextRun,
	hiddenCompletedText,
	nextCronRun,
	RoutineCollector,
	routineNextRunAt,
	routineStatus,
	sortRoutines,
	type ExtractedRoutine,
} from "../src/lib/routines";

interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
	timestamp: string;
	resultText: string;
	toolUseResult: unknown;
	isError?: boolean;
}

function callRecords(call: ToolCall): unknown[] {
	return [
		{
			type: "assistant",
			uuid: `${call.id}-use`,
			timestamp: call.timestamp,
			message: {
				role: "assistant",
				content: [{type: "tool_use", id: call.id, name: call.name, input: call.input}],
			},
		},
		{
			type: "user",
			uuid: `${call.id}-result`,
			timestamp: call.timestamp,
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: call.id,
						content: call.resultText,
						...(call.isError === true ? {is_error: true} : {}),
					},
				],
			},
			toolUseResult: call.toolUseResult,
		},
	];
}

function collect(calls: ToolCall[]): ExtractedRoutine[] {
	const collector = new RoutineCollector();
	for (const call of calls) for (const record of callRecords(call)) collector.add(record);
	return collector.routines();
}

const recurringCron: ToolCall = {
	id: "toolu_cron_recurring",
	name: "CronCreate",
	input: {cron: "*/5 * * * *", prompt: "Check draft PR #12.", recurring: true},
	timestamp: "2026-08-15T22:40:27.581Z",
	resultText: "Scheduled recurring job 4e4825bd (Every 5 minutes).",
	toolUseResult: {
		id: "4e4825bd",
		humanSchedule: "Every 5 minutes",
		recurring: true,
		durable: false,
	},
};

const oneShotCron: ToolCall = {
	id: "toolu_cron_once",
	name: "CronCreate",
	input: {cron: "0 20 16 9 *", recurring: false, prompt: "Retry the NextDNS follow-ups."},
	timestamp: "2026-09-16T22:00:05.113Z",
	resultText: "Scheduled one-shot task 999368ab (0 20 16 9 *).",
	toolUseResult: {
		id: "999368ab",
		humanSchedule: "0 20 16 9 *",
		recurring: false,
		durable: true,
	},
};

const cronDelete: ToolCall = {
	id: "toolu_cron_delete",
	name: "CronDelete",
	input: {id: "4e4825bd"},
	timestamp: "2026-08-15T22:45:00.000Z",
	resultText: "Cancelled job 4e4825bd.",
	toolUseResult: {id: "4e4825bd"},
};

const wakeup: ToolCall = {
	id: "toolu_wakeup",
	name: "ScheduleWakeup",
	input: {
		delaySeconds: 3600,
		noop: false,
		prompt: "Remind Craig to upload the build.",
		reason: "One-hour sleep",
	},
	timestamp: "2026-09-23T22:53:30.911Z",
	resultText: "Next wakeup scheduled for 19:54:00 (in 3624s).",
	toolUseResult: {scheduledFor: 1790207640000, clampedDelaySeconds: 3600, wasClamped: false},
};

const wakeupStop: ToolCall = {
	id: "toolu_wakeup_stop",
	name: "ScheduleWakeup",
	input: {stop: true},
	timestamp: "2026-09-23T23:54:09.974Z",
	resultText: "Loop stopped.",
	toolUseResult: {
		scheduledFor: 0,
		clampedDelaySeconds: 0,
		wasClamped: false,
		stopped: true,
		cancelledWakeups: 1,
	},
};

const remoteCreate: ToolCall = {
	id: "toolu_remote",
	name: "RemoteTrigger",
	input: {
		action: "create",
		body: {
			name: "Reminder: upload Mnemonica",
			run_once_at: "2026-09-23T12:00:00Z",
			enabled: true,
		},
	},
	timestamp: "2026-09-23T02:42:45.415Z",
	resultText: "HTTP 200",
	toolUseResult: {
		status: 200,
		json: JSON.stringify({
			outcome: "CREATE_TRIGGER_OUTCOME_CREATED",
			trigger: {
				id: "trig_018T8GbwA5GCSPBvYaTMLzwe",
				cron_expression: "",
				derived_state: {prompt: "Reply with the upload reminder."},
			},
		}),
	},
};

const remoteList: ToolCall = {
	id: "toolu_remote_list",
	name: "RemoteTrigger",
	input: {action: "list"},
	timestamp: "2026-09-23T02:50:00.000Z",
	resultText: "HTTP 200",
	toolUseResult: {status: 200, json: "{}"},
};

const deniedCron: ToolCall = {
	id: "toolu_cron_denied",
	name: "CronCreate",
	input: {cron: "43 10 * * *", prompt: "Daily sweep"},
	timestamp: "2026-08-16T20:34:04.900Z",
	resultText: "Permission for this action was denied.",
	toolUseResult: "Error: Permission for this action was denied.",
	isError: true,
};

describe("RoutineCollector", () => {
	it("extracts a recurring CronCreate with its job id and human schedule", () => {
		expect(collect([recurringCron])).toStrictEqual([
			{
				toolUseId: "toolu_cron_recurring",
				recordUuid: "toolu_cron_recurring-use",
				kind: "cron",
				routineId: "4e4825bd",
				name: null,
				schedule: "*/5 * * * *",
				humanSchedule: "Every 5 minutes",
				delaySeconds: null,
				runOnceAt: null,
				recurring: true,
				durable: false,
				prompt: "Check draft PR #12.",
				createdAt: Date.parse("2026-08-15T22:40:27.581Z"),
				deletedAt: null,
			},
		]);
	});

	it("extracts a one-shot CronCreate as not recurring and keeps the durable flag", () => {
		const [routine] = collect([oneShotCron]);
		expect({
			kind: routine?.kind,
			routineId: routine?.routineId,
			recurring: routine?.recurring,
			durable: routine?.durable,
			schedule: routine?.schedule,
		}).toStrictEqual({
			kind: "cron",
			routineId: "999368ab",
			recurring: false,
			durable: true,
			schedule: "0 20 16 9 *",
		});
	});

	it("extracts a ScheduleWakeup as a one-time wakeup at its scheduled time", () => {
		expect(collect([wakeup])).toStrictEqual([
			{
				toolUseId: "toolu_wakeup",
				recordUuid: "toolu_wakeup-use",
				kind: "wakeup",
				routineId: null,
				name: null,
				schedule: null,
				humanSchedule: null,
				delaySeconds: 3600,
				runOnceAt: 1790207640000,
				recurring: false,
				durable: false,
				prompt: "Remind Craig to upload the build.",
				createdAt: Date.parse("2026-09-23T22:53:30.911Z"),
				deletedAt: null,
			},
		]);
	});

	it("marks a cron cancelled by CronDelete and a wakeup ended by a stop call", () => {
		const routines = collect([recurringCron, cronDelete, wakeup, wakeupStop]);
		expect(routines.map((routine) => ({toolUseId: routine.toolUseId, deletedAt: routine.deletedAt}))).toStrictEqual(
			[
				{toolUseId: "toolu_cron_recurring", deletedAt: Date.parse("2026-08-15T22:45:00.000Z")},
				{toolUseId: "toolu_wakeup", deletedAt: Date.parse("2026-09-23T23:54:09.974Z")},
			],
		);
	});

	it("marks a RemoteTrigger create as a cloud routine and ignores other actions", () => {
		expect(collect([remoteCreate, remoteList])).toStrictEqual([
			{
				toolUseId: "toolu_remote",
				recordUuid: "toolu_remote-use",
				kind: "cloud",
				routineId: "trig_018T8GbwA5GCSPBvYaTMLzwe",
				name: "Reminder: upload Mnemonica",
				schedule: null,
				humanSchedule: null,
				delaySeconds: null,
				runOnceAt: Date.parse("2026-09-23T12:00:00Z"),
				recurring: false,
				durable: true,
				prompt: "Reply with the upload reminder.",
				createdAt: Date.parse("2026-09-23T02:42:45.415Z"),
				deletedAt: null,
			},
		]);
	});

	it("skips calls whose result is an error", () => {
		expect(collect([deniedCron])).toStrictEqual([]);
	});
});

describe("nextCronRun", () => {
	it("finds the next matching local minute after the given time", () => {
		const from = new Date(2026, 8, 29, 10, 2, 30).getTime();
		expect([
			nextCronRun("*/5 * * * *", from),
			nextCronRun("43 10 * * *", from),
			nextCronRun("0 9 * * 1", from),
			nextCronRun("0 20 16 9 *", from),
			nextCronRun("not a cron", from),
		]).toStrictEqual([
			new Date(2026, 8, 29, 10, 5).getTime(),
			new Date(2026, 8, 29, 10, 43).getTime(),
			new Date(2026, 9, 5, 9, 0).getTime(),
			new Date(2027, 8, 16, 20, 0).getTime(),
			null,
		]);
	});
});

function extracted(overrides: Partial<ExtractedRoutine>): ExtractedRoutine {
	return {
		toolUseId: "toolu_x",
		recordUuid: "uuid-x",
		kind: "cron",
		routineId: "abc12345",
		name: null,
		schedule: "*/5 * * * *",
		humanSchedule: "Every 5 minutes",
		delaySeconds: null,
		runOnceAt: null,
		recurring: true,
		durable: false,
		prompt: "Poll the PR",
		createdAt: new Date(2026, 8, 29, 9, 0).getTime(),
		deletedAt: null,
		...overrides,
	};
}

describe("routineStatus", () => {
	const now = new Date(2026, 8, 29, 10, 2).getTime();
	const liveNoStop = {sessionCrons: null, sessionCronsAt: null};

	it("is completed once deleted or when the session is no longer running", () => {
		expect([
			routineStatus(extracted({deletedAt: now - 1000}), liveNoStop, now),
			routineStatus(extracted({}), undefined, now),
		]).toStrictEqual(["completed", "completed"]);
	});

	it("follows the latest Stop session_crons when it was reported after creation", () => {
		const after = new Date(2026, 8, 29, 9, 30).getTime();
		const cron = {
			id: "abc12345",
			schedule: "*/5 * * * *",
			recurring: true,
			prompt: "Poll the PR",
		};
		expect([
			routineStatus(extracted({}), {sessionCrons: [cron], sessionCronsAt: after}, now),
			routineStatus(extracted({}), {sessionCrons: [], sessionCronsAt: after}, now),
			routineStatus(extracted({createdAt: now - 60_000}), {sessionCrons: [], sessionCronsAt: after}, now),
		]).toStrictEqual(["active", "completed", "active"]);
	});

	it("falls back to the schedule while the session is live", () => {
		expect([
			routineStatus(extracted({}), liveNoStop, now),
			routineStatus(
				extracted({kind: "wakeup", schedule: null, recurring: false, runOnceAt: now - 1}),
				liveNoStop,
				now,
			),
			routineStatus(
				extracted({kind: "wakeup", schedule: null, recurring: false, runOnceAt: now + 60_000}),
				liveNoStop,
				now,
			),
		]).toStrictEqual(["active", "completed", "active"]);
	});

	it("keeps cloud routines active until their one-time run passes", () => {
		const cloud = extracted({kind: "cloud", schedule: null, recurring: false, durable: true});
		expect([
			routineStatus({...cloud, runOnceAt: now + 60_000}, undefined, now),
			routineStatus({...cloud, runOnceAt: now - 60_000}, undefined, now),
		]).toStrictEqual(["active", "completed"]);
	});
});

describe("routineNextRunAt", () => {
	it("uses the cron for recurring routines and the fixed time for one-time routines", () => {
		const now = new Date(2026, 8, 29, 10, 2).getTime();
		expect([
			routineNextRunAt(extracted({}), now),
			routineNextRunAt(extracted({recurring: false, runOnceAt: now + 5}), now),
			routineNextRunAt(extracted({recurring: false, runOnceAt: now - 5}), now),
			routineNextRunAt(extracted({recurring: false, schedule: "30 10 29 9 *", humanSchedule: null}), now),
		]).toStrictEqual([new Date(2026, 8, 29, 10, 5).getTime(), now + 5, null, now + 28 * 60_000]);
	});
});

function routine(overrides: Partial<Routine>): Routine {
	return {
		...extracted({}),
		sessionId: "session-a",
		projectId: "-Users-alice-projects-app",
		sessionTitle: "Fix the build",
		status: "active",
		nextRunAt: null,
		...overrides,
	};
}

describe("filterRoutines", () => {
	const rows = [
		routine({toolUseId: "a", prompt: "Poll the PR", recurring: true}),
		routine({toolUseId: "b", prompt: "Nightly deploy", recurring: false, status: "completed"}),
		routine({toolUseId: "c", prompt: "Remind me", recurring: false, kind: "wakeup"}),
		routine({toolUseId: "d", prompt: "Weekly sweep", recurring: true, status: "completed"}),
	];
	const ids = (result: {visible: Routine[]}) => result.visible.map((row) => row.toolUseId);

	it("hides completed routines by default and counts them", () => {
		const result = filterRoutines(rows, DEFAULT_ROUTINE_VIEW);
		expect({ids: ids(result), hidden: result.hiddenCompleted}).toStrictEqual({
			ids: ["a", "c"],
			hidden: 2,
		});
	});

	it("shows completed routines when included or when filtering by Completed", () => {
		expect([
			ids(filterRoutines(rows, {...DEFAULT_ROUTINE_VIEW, includeCompleted: true})),
			ids(filterRoutines(rows, {...DEFAULT_ROUTINE_VIEW, status: "completed"})),
			filterRoutines(rows, {...DEFAULT_ROUTINE_VIEW, status: "completed"}).hiddenCompleted,
		]).toStrictEqual([["a", "b", "c", "d"], ["b", "d"], 0]);
	});

	it("filters by schedule and searches prompt, name and session title", () => {
		expect([
			ids(filterRoutines(rows, {...DEFAULT_ROUTINE_VIEW, schedule: "recurring"})),
			ids(filterRoutines(rows, {...DEFAULT_ROUTINE_VIEW, schedule: "one-time"})),
			ids(filterRoutines(rows, {...DEFAULT_ROUTINE_VIEW, search: "REMIND"})),
			ids(filterRoutines(rows, {...DEFAULT_ROUTINE_VIEW, search: "fix the"})),
		]).toStrictEqual([["a"], ["c"], ["c"], ["a", "c"]]);
	});

	it("only counts hidden completed routines that match the other filters", () => {
		expect(filterRoutines(rows, {...DEFAULT_ROUTINE_VIEW, schedule: "recurring"}).hiddenCompleted).toBe(1);
	});
});

describe("sortRoutines", () => {
	it("sorts by next run with unscheduled rows last, or by name", () => {
		const rows = [
			routine({toolUseId: "late", prompt: "Beta", nextRunAt: 3000}),
			routine({toolUseId: "none", prompt: "Alpha", nextRunAt: null}),
			routine({toolUseId: "soon", prompt: "Gamma", nextRunAt: 1000}),
			routine({toolUseId: "named", name: "Aardvark", prompt: "Zulu", nextRunAt: 2000}),
		];
		expect({
			nextRun: sortRoutines(rows, "next-run").map((row) => row.toolUseId),
			name: sortRoutines(rows, "name").map((row) => row.toolUseId),
		}).toStrictEqual({
			nextRun: ["soon", "named", "late", "none"],
			name: ["named", "none", "late", "soon"],
		});
	});
});

describe("formatNextRun", () => {
	it("names today and tomorrow, then the date", () => {
		const now = new Date(2026, 8, 29, 10, 0).getTime();
		expect([
			formatNextRun(new Date(2026, 8, 29, 15, 45).getTime(), now),
			formatNextRun(new Date(2026, 8, 30, 9, 0).getTime(), now),
			formatNextRun(new Date(2026, 9, 5, 9, 0).getTime(), now),
			formatNextRun(new Date(2027, 0, 2, 9, 0).getTime(), now),
		]).toStrictEqual(["today at 3:45 PM", "tomorrow at 9:00 AM", "Oct 5 at 9:00 AM", "Jan 2, 2027 at 9:00 AM"]);
	});
});

describe("hiddenCompletedText", () => {
	it("matches upstream's hidden-count copy", () => {
		expect([hiddenCompletedText(1), hiddenCompletedText(3)]).toStrictEqual([
			"1 completed routine hidden",
			"3 completed routines hidden",
		]);
	});
});

describe("routine index", () => {
	const testDir = join(tmpdir(), `claude-routines-index-test-${process.pid}`);
	const projectId = "-Users-alice-projects-app";
	const sessionId = "session-routines-a";
	let db: AppDb;

	beforeEach(() => {
		mkdirSync(join(testDir, projectId), {recursive: true});
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
		rmSync(testDir, {recursive: true, force: true});
	});

	it("indexes routines from a transcript and reports them with live status", async () => {
		const filePath = join(testDir, projectId, `${sessionId}.jsonl`);
		const lines = [
			{
				type: "user",
				uuid: "u0",
				timestamp: "2026-08-15T22:40:00.000Z",
				message: {role: "user", content: "Watch PR #12"},
			},
			...callRecords(recurringCron),
			...callRecords(cronDelete),
			...callRecords({...oneShotCron, timestamp: new Date(2026, 8, 16, 18, 0).toISOString()}),
		];
		writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

		await indexJsonlFile(db.index, filePath, projectId);
		const now = new Date(2026, 8, 16, 12, 0).getTime();
		const live = new Map([[sessionId, {sessionCrons: null, sessionCronsAt: null}]]);

		expect(
			getRoutines(db.index, {now, liveSessions: live}).map((row) => ({
				toolUseId: row.toolUseId,
				sessionId: row.sessionId,
				sessionTitle: row.sessionTitle,
				status: row.status,
				nextRunAt: row.nextRunAt,
			})),
		).toStrictEqual([
			{
				toolUseId: "toolu_cron_once",
				sessionId,
				sessionTitle: "Watch PR #12",
				status: "active",
				nextRunAt: new Date(2026, 8, 16, 20, 0).getTime(),
			},
			{
				toolUseId: "toolu_cron_recurring",
				sessionId,
				sessionTitle: "Watch PR #12",
				status: "completed",
				nextRunAt: null,
			},
		]);

		writeFileSync(filePath, JSON.stringify(lines[0]) + "\n");
		await indexJsonlFile(db.index, filePath, projectId);
		expect(db.index.select().from(schema.routines).all()).toStrictEqual([]);
	});
});
