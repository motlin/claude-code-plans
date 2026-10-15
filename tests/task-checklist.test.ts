import {describe, expect, it} from "vite-plus/test";

import {taskChecklist} from "../src/lib/task-checklist";

describe("taskChecklist", () => {
	it("lists TodoWrite's todos by content (else text), ignoring activeForm, a later duplicate id replacing the earlier in place", () => {
		expect(
			taskChecklist("TodoWrite", {
				todos: [
					{content: "Write tests", status: "completed", activeForm: "Writing tests"},
					{id: "b", text: "Ship it", status: "in_progress"},
					{content: "", status: "pending"},
					"junk",
					{content: "Review", status: "blocked"},
					{id: "b", content: "Ship it now", status: "completed"},
				],
			}),
		).toStrictEqual([
			{id: "todo-0", content: "Write tests", status: "completed"},
			{id: "b", content: "Ship it now", status: "completed"},
			{id: "todo-4", content: "Review", status: "pending"},
		]);
	});

	it("gives TaskCreate and TaskUpdate one item from description, else subject, with their status or pending", () => {
		expect([
			taskChecklist("TaskCreate", {subject: "Audit", description: "Audit the schema"}),
			taskChecklist("TaskCreate", {subject: "Audit"}),
			taskChecklist("TaskUpdate", {taskId: "1", subject: "Audit", status: "in_progress"}),
			taskChecklist("TaskUpdate", {taskId: "1", status: "completed"}),
			taskChecklist("TaskCreate", {subject: "  "}),
		]).toStrictEqual([
			[{id: "task", content: "Audit the schema", status: "pending"}],
			[{id: "task", content: "Audit", status: "pending"}],
			[{id: "task", content: "Audit", status: "in_progress"}],
			[],
			[],
		]);
	});

	it("gives TaskGet, TaskList and TaskStop an empty list", () => {
		expect([
			taskChecklist("TaskGet", {taskId: "1"}),
			taskChecklist("TaskList", {}),
			taskChecklist("TaskStop", {task_id: "b1"}),
		]).toStrictEqual([[], [], []]);
	});

	it("strips <cc-memory> tags from item text", () => {
		expect(
			taskChecklist("TodoWrite", {
				todos: [{content: 'Read <cc-memory filenames="a.md">the notes</cc-memory> first', status: "pending"}],
			}),
		).toStrictEqual([{id: "todo-0", content: "Read the notes first", status: "pending"}]);
	});
});
