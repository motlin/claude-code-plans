import {describe, expect, it} from "vite-plus/test";

import {sessionPlanModel} from "../src/lib/session-plan-model";
import {processTranscript} from "../src/lib/transcript";

function assistant(uuid: string, toolUses: Array<{id: string; name: string; input: Record<string, unknown>}>) {
	return {
		type: "assistant",
		uuid,
		timestamp: "2026-10-14T10:00:00.000Z",
		message: {role: "assistant", content: toolUses.map((use) => ({type: "tool_use", ...use}))},
	};
}

function model(records: unknown[]) {
	return sessionPlanModel(processTranscript(records).lines);
}

describe("sessionPlanModel", () => {
	it("is empty with no ExitPlanMode plan and no todos", () => {
		expect(model([assistant("a1", [{id: "t1", name: "Bash", input: {command: "ls"}}])])).toStrictEqual({
			content: null,
			todos: [],
		});
	});

	it("takes the latest ExitPlanMode plan text, as upstream's plan model", () => {
		expect(
			model([
				assistant("a1", [{id: "t1", name: "ExitPlanMode", input: {plan: "First plan"}}]),
				assistant("a2", [{id: "t2", name: "ExitPlanMode", input: {plan: "## Second plan"}}]),
			]).content,
		).toBe("## Second plan");
	});

	it("keeps the latest TodoWrite checklist", () => {
		expect(
			model([
				assistant("a1", [
					{
						id: "t1",
						name: "TodoWrite",
						input: {todos: [{content: "Write tests", status: "completed", activeForm: "Writing tests"}]},
					},
				]),
				assistant("a2", [
					{
						id: "t2",
						name: "TodoWrite",
						input: {
							todos: [
								{content: "Write tests", status: "completed", activeForm: "Writing tests"},
								{content: "Ship it", status: "in_progress", activeForm: "Shipping it"},
							],
						},
					},
				]),
			]).todos,
		).toStrictEqual([
			{content: "Write tests", status: "completed", activeForm: "Writing tests"},
			{content: "Ship it", status: "in_progress", activeForm: "Shipping it"},
		]);
	});

	it("builds todos from TaskCreate, numbered in creation order, and TaskUpdate status changes", () => {
		expect(
			model([
				assistant("a1", [
					{id: "t1", name: "TaskCreate", input: {subject: "Audit the schema", activeForm: "Auditing"}},
					{id: "t2", name: "TaskCreate", input: {subject: "Fix the drift"}},
				]),
				assistant("a2", [{id: "t3", name: "TaskUpdate", input: {taskId: "1", status: "completed"}}]),
			]).todos,
		).toStrictEqual([
			{content: "Audit the schema", status: "completed", activeForm: "Auditing"},
			{content: "Fix the drift", status: "pending"},
		]);
	});
});
