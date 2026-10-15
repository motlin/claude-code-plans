// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {TaskChecklistRenderer} from "../src/components/tool-renderers/task-checklist-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

afterEach(cleanup);

function call(name: string, input: Record<string, unknown>): ClientToolCall {
	return {id: "t1", name, param: "", sourceUuid: "u1", input};
}

describe("TaskChecklistRenderer", () => {
	it("draws upstream's checklist: a 16px status slot, inline markdown, done struck through, in progress spinning", () => {
		const {container} = render(
			<TaskChecklistRenderer
				toolCall={call("TodoWrite", {
					todos: [
						{content: "Update **docs**", status: "completed"},
						{content: "Fix `login`", status: "in_progress", activeForm: "Fixing login"},
						{content: "Write tests", status: "pending"},
					],
				})}
			/>,
		);
		const list = container.querySelector("ul");

		expect({
			list: list?.className,
			items: [...(list?.children ?? [])].map((item) => ({
				className: item.className,
				icon: item.firstElementChild?.firstElementChild?.getAttribute("class")?.split(" ")[0],
				text: item.textContent,
				markdown: item.querySelector("strong, code")?.tagName ?? null,
			})),
		}).toStrictEqual({
			list: "m-0 flex list-none flex-col gap-1.5 p-0 py-1.5 text-body select-text",
			items: [
				{
					className: "flex items-start gap-1 line-through decoration-1 text-secondary",
					icon: "lucide",
					text: "doneUpdate docs",
					markdown: "STRONG",
				},
				{
					className: "flex items-start gap-1 text-primary",
					icon: "running-spinner",
					text: "in progressFix login",
					markdown: "CODE",
				},
				{className: "flex items-start gap-1 text-primary", icon: "lucide", text: "Write tests", markdown: null},
			],
		});
	});

	it("draws a TaskCreate's one task and nothing for a task tool with no list", () => {
		const created = render(<TaskChecklistRenderer toolCall={call("TaskCreate", {subject: "Audit"})} />).container
			.textContent;
		cleanup();
		const listed = render(<TaskChecklistRenderer toolCall={call("TaskList", {})} />).container.innerHTML;

		expect({created, listed}).toStrictEqual({created: "Audit", listed: ""});
	});
});
