// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {createElement} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {getToolRenderer} from "../src/components/tool-renderers";
import {FallbackRenderer} from "../src/components/tool-renderers/fallback-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {toolInputSchemas} from "../src/lib/tool-input-schemas";
import {toolLabel, type ToolLabel} from "../src/lib/tool-labels";

afterEach(cleanup);

function label(name: string, input: Record<string, unknown>): ToolLabel {
	return toolLabel({name, input});
}

const WAKEUP_INPUT = {
	delaySeconds: 1800,
	noop: false,
	reason: "Check the PR again",
	prompt: "/loop Check PR 19",
};

const SEND_USER_FILE_INPUT = {
	files: ["/tmp/scratch/before.png"],
	caption: "Before the fix",
	status: "normal",
	display: "render",
};

describe("worktree, scheduling, notification and workflow labels", () => {
	it("labels worktree rows by whether a worktree was created, entered or removed", () => {
		expect({
			create: label("EnterWorktree", {name: "blog-draft"}),
			createUnnamed: label("EnterWorktree", {}),
			enter: label("EnterWorktree", {path: "/Users/me/projects/app-feature"}),
			exitKeep: label("ExitWorktree", {action: "keep"}),
			exitRemove: label("ExitWorktree", {action: "remove", discard_changes: true}),
		}).toStrictEqual({
			create: {
				verb: "Created a worktree",
				meta: "blog-draft",
				failedVerb: "Failed to create a worktree",
			},
			createUnnamed: {verb: "Created a worktree", failedVerb: "Failed to create a worktree"},
			enter: {
				verb: "Entered a worktree",
				meta: "app-feature",
				failedVerb: "Failed to enter a worktree",
			},
			exitKeep: {verb: "Left the worktree", failedVerb: "Failed to leave the worktree"},
			exitRemove: {verb: "Left the worktree", failedVerb: "Failed to remove the worktree"},
		});
	});

	it("labels wakeups and cron prompts as check-ins, loops and scheduled prompts", () => {
		expect({
			wakeup: label("ScheduleWakeup", WAKEUP_INPUT),
			wakeupNoReason: label("ScheduleWakeup", {delaySeconds: 60, prompt: "go"}),
			stopLoop: label("ScheduleWakeup", {stop: true}),
			oneShot: label("CronCreate", {cron: "0 9 * * *", prompt: "Check CI", recurring: false}),
			loop: label("CronCreate", {cron: "*/5 * * * *", prompt: "Poll the PR", recurring: true}),
			loopDefault: label("CronCreate", {cron: "*/5 * * * *", prompt: "Poll the PR"}),
			loopSentinel: label("CronCreate", {cron: "*/5 * * * *", prompt: "<<autonomous-loop>>"}),
			cronList: label("CronList", {}),
			cronDelete: label("CronDelete", {id: "4e4825bd"}),
		}).toStrictEqual({
			wakeup: {
				verb: "Scheduled check-in",
				meta: "Check the PR again",
				failedVerb: "Failed to schedule check-in",
			},
			wakeupNoReason: {verb: "Scheduled check-in", failedVerb: "Failed to schedule check-in"},
			stopLoop: {verb: "Stopped loop", failedVerb: "Failed to stop loop"},
			oneShot: {
				verb: "Scheduled prompt",
				meta: "Check CI",
				failedVerb: "Failed to schedule prompt",
			},
			loop: {verb: "Started loop", meta: "Poll the PR", failedVerb: "Failed to start loop"},
			loopDefault: {
				verb: "Started loop",
				meta: "Poll the PR",
				failedVerb: "Failed to start loop",
			},
			loopSentinel: {verb: "Started loop", failedVerb: "Failed to start loop"},
			cronList: {
				verb: "Listed scheduled prompts",
				failedVerb: "Failed to list scheduled prompts",
			},
			cronDelete: {
				verb: "Stopped scheduled prompt",
				failedVerb: "Failed to stop scheduled prompt",
			},
		});
	});

	it("labels routine triggers by action", () => {
		expect({
			list: label("RemoteTrigger", {action: "list"}),
			get: label("RemoteTrigger", {action: "get", trigger_id: "t1"}),
			create: label("RemoteTrigger", {action: "create", body: {name: "Reminder"}}),
			update: label("RemoteTrigger", {action: "update", trigger_id: "t1", body: {}}),
			run: label("RemoteTrigger", {action: "run", trigger_id: "t1"}),
		}).toStrictEqual({
			list: {verb: "Listed routines", failedVerb: "Failed to list routines"},
			get: {verb: "Read routine", failedVerb: "Failed to read routine"},
			create: {verb: "Created routine", failedVerb: "Failed to create routine"},
			update: {verb: "Updated routine", failedVerb: "Failed to update routine"},
			run: {verb: "Ran routine", failedVerb: "Failed to run routine"},
		});
	});

	it("labels messages, files, notifications, workflows, LSP and MCP resources", () => {
		expect({
			sendUserMessage: label("SendUserMessage", {message: "Done"}),
			sendUserFile: label("SendUserFile", SEND_USER_FILE_INPUT),
			push: label("PushNotification", {message: "PR is green", status: "proactive"}),
			workflow: label("Workflow", {scriptPath: "/x/wf.js"}),
			lsp: label("LSP", {file_path: "src/a.ts", line: 1, character: 2}),
			listResources: label("ListMcpResourcesTool", {}),
			readResource: label("ReadMcpResourceTool", {server: "s", uri: "u"}),
			readResourceDir: label("ReadMcpResourceDirTool", {}),
		}).toStrictEqual({
			sendUserMessage: {verb: "Sent", failedVerb: "Failed to send"},
			sendUserFile: {verb: "Sent", failedVerb: "Failed to send"},
			push: {verb: "Sent notification", failedVerb: "Failed to send notification"},
			workflow: {verb: "Ran workflow", failedVerb: "Failed to run workflow"},
			lsp: {verb: "Inspected code", failedVerb: "Failed to inspect code"},
			listResources: {verb: "Listed resources", failedVerb: "Failed to list resources"},
			readResource: {verb: "Read resource", failedVerb: "Failed to read resource"},
			readResourceDir: {
				verb: "Listed resource folder",
				failedVerb: "Failed to list resource folder",
			},
		});
	});
});

describe("misc tool bodies", () => {
	it("renders these tools through the KeyValue fallback body", () => {
		const fallback = getToolRenderer("Frobnicate");
		const names = [
			"EnterWorktree",
			"ExitWorktree",
			"ScheduleWakeup",
			"CronList",
			"CronDelete",
			"RemoteTrigger",
			"SendUserFile",
			"SendUserMessage",
			"PushNotification",
			"Workflow",
			"LSP",
		];
		expect(names.filter((name) => getToolRenderer(name) !== fallback)).toStrictEqual([]);
	});

	it("shows the wakeup params as key/value pairs", () => {
		const call: ClientToolCall = {
			id: "tool-wakeup",
			name: "ScheduleWakeup",
			param: "",
			sourceUuid: "uuid-1",
			input: WAKEUP_INPUT,
		};
		const {container} = render(createElement(FallbackRenderer, {toolCall: call}));
		expect(container.textContent).toContain("reason: Check the PR again");
		expect(container.textContent).toContain("delaySeconds: 1800");
	});
});

describe("misc tool input schemas", () => {
	it("accepts the input shapes seen on disk", () => {
		expect({
			enterNamed: toolInputSchemas.EnterWorktree.safeParse({name: "blog-draft"}).success,
			enterPath: toolInputSchemas.EnterWorktree.safeParse({path: "/x/app"}).success,
			enterEmpty: toolInputSchemas.EnterWorktree.safeParse({}).success,
			exit: toolInputSchemas.ExitWorktree.safeParse({action: "remove", discard_changes: true}).success,
			wakeup: toolInputSchemas.ScheduleWakeup.safeParse(WAKEUP_INPUT).success,
			wakeupStop: toolInputSchemas.ScheduleWakeup.safeParse({stop: true}).success,
			cronDurable: toolInputSchemas.CronCreate.safeParse({
				cron: "43 10 * * *",
				prompt: "Daily sweep",
				durable: true,
				recurring: true,
			}).success,
			remoteTrigger: toolInputSchemas.RemoteTrigger.safeParse({
				action: "create",
				body: {name: "Reminder", run_once_at: "2026-09-29T10:00:00Z"},
			}).success,
			sendUserFile: toolInputSchemas.SendUserFile.safeParse(SEND_USER_FILE_INPUT).success,
			push: toolInputSchemas.PushNotification.safeParse({
				message: "PR is green",
				status: "proactive",
			}).success,
			workflowScript: toolInputSchemas.Workflow.safeParse({
				script: "export const meta = {}",
				args: [{name: "repo", path: "/x/repo"}],
			}).success,
			workflowResume: toolInputSchemas.Workflow.safeParse({
				scriptPath: "/x/wf.js",
				resumeFromRunId: "wf_1",
			}).success,
		}).toStrictEqual({
			enterNamed: true,
			enterPath: true,
			enterEmpty: true,
			exit: true,
			wakeup: true,
			wakeupStop: true,
			cronDurable: true,
			remoteTrigger: true,
			sendUserFile: true,
			push: true,
			workflowScript: true,
			workflowResume: true,
		});
	});

	it("rejects unknown keys and actions", () => {
		expect({
			exitAction: toolInputSchemas.ExitWorktree.safeParse({action: "delete"}).success,
			wakeup: toolInputSchemas.ScheduleWakeup.safeParse({...WAKEUP_INPUT, extra: 1}).success,
			remoteTriggerAction: toolInputSchemas.RemoteTrigger.safeParse({action: "delete"}).success,
			sendUserFile: toolInputSchemas.SendUserFile.safeParse({...SEND_USER_FILE_INPUT, extra: 1}).success,
			push: toolInputSchemas.PushNotification.safeParse({message: "x", extra: 1}).success,
			workflow: toolInputSchemas.Workflow.safeParse({scriptPath: "/x", extra: 1}).success,
		}).toStrictEqual({
			exitAction: false,
			wakeup: false,
			remoteTriggerAction: false,
			sendUserFile: false,
			push: false,
			workflow: false,
		});
	});
});
