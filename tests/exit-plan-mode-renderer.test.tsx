// @vitest-environment jsdom

import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ExitPlanModeRenderer} from "../src/components/tool-renderers/exit-plan-mode-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

afterEach(cleanup);

const APPROVED_RESULT =
	"User has approved your plan. You can now start coding. Start with updating your todo list if applicable\n\nYour plan has been saved to: /Users/craig/.claude/plans/switch-git-pager.md\nYou can refer back to it if needed during implementation.";

const REJECTED_RESULT =
	"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nalso plan on working in a new worktree";

function makeToolCall(overrides: Partial<ClientToolCall>): ClientToolCall {
	return {
		id: "tool-epm-1",
		name: "ExitPlanMode",
		param: "",
		sourceUuid: "uuid-1",
		input: {},
		...overrides,
	};
}

async function renderRenderer(toolCall: ClientToolCall, verbose = false) {
	const rootRoute = createRootRoute({
		component: () => <ExitPlanModeRenderer toolCall={toolCall} verbose={verbose} />,
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({initialEntries: ["/"]}),
	});
	await router.load();
	return render(<RouterProvider router={router} />);
}

const PLAN_BLOCK = "text-body text-secondary whitespace-pre-wrap break-words ps-2 border-s-2";
const PLAN_FILE_ACTION = "shrink-0 text-footnote text-secondary hover:text-primary hover:underline";

describe("ExitPlanModeRenderer", () => {
	it("draws a pending plan as upstream's left-bordered secondary block, its text verbatim", async () => {
		const view = await renderRenderer(makeToolCall({input: {plan: "# Switch git pager\n\n- use hunk"}}));
		const block = view.container.querySelector("[data-plan-block]");

		expect({
			className: block?.className,
			text: block?.textContent,
			headings: view.container.querySelectorAll("h1, ul").length,
			approved: view.container.textContent.includes("Plan approved"),
		}).toStrictEqual({
			className: `${PLAN_BLOCK} py-1.5`,
			text: "# Switch git pager\n\n- use hunk",
			headings: 0,
			approved: false,
		});
	});

	it("leads an approved plan with upstream's 'Plan approved' and a check circle, above the block", async () => {
		const view = await renderRenderer(
			makeToolCall({input: {plan: "Do it."}, result: "User has approved your plan. You can now start coding."}),
		);
		const done = view.container.querySelector("[data-plan-done]");

		expect({
			className: done?.className,
			children: [...(done?.children ?? [])].map((child) => ({
				className: child.className,
				text: child.textContent,
			})),
			icon: done?.querySelector("svg")?.getAttribute("class")?.includes("lucide-circle-check"),
			showsBoilerplate: view.container.textContent.includes("You can now start coding"),
		}).toStrictEqual({
			className: "flex flex-col gap-1 py-1.5",
			children: [
				{className: "flex items-center justify-between gap-2", text: "Plan approved"},
				{className: PLAN_BLOCK, text: "Do it."},
			],
			icon: true,
			showsBoilerplate: false,
		});
	});

	it("omits the status on a rejected plan by default, as upstream does on error, and shows it in Verbose", async () => {
		const call = makeToolCall({input: {plan: "Do it."}, result: REJECTED_RESULT, isError: true});
		const normal = (await renderRenderer(call)).container.textContent;
		cleanup();
		const verbose = (await renderRenderer(call, true)).container.textContent;

		expect({
			normal,
			verbose: [verbose.includes("Plan rejected"), verbose.includes("also plan on working in a new worktree")],
		}).toStrictEqual({normal: "Do it.", verbose: [true, true]});
	});

	it("keeps the allowed prompts behind Verbose", async () => {
		const call = makeToolCall({
			input: {
				plan: "Do the thing.",
				allowedPrompts: [
					{tool: "Bash", prompt: "stage and commit git changes"},
					{tool: "Bash", prompt: "run just precommit"},
				],
			},
			result: APPROVED_RESULT,
		});
		const normal = (await renderRenderer(call)).container.querySelectorAll("[data-allowed-prompt]").length;
		cleanup();
		const verbose = [...(await renderRenderer(call, true)).container.querySelectorAll("[data-allowed-prompt]")].map(
			(el) => el.textContent,
		);

		expect({normal, verbose}).toStrictEqual({
			normal: 0,
			verbose: ["Bash — stage and commit git changes", "Bash — run just precommit"],
		});
	});

	it("puts 'Open plan file' as the trailing action on the 'Plan approved' row, never 'created'", async () => {
		const view = await renderRenderer(
			makeToolCall({
				input: {plan: "Do it.", planFilePath: "/Users/craig/.claude/plans/switch-git-pager.md"},
				result: APPROVED_RESULT,
			}),
		);
		const link = screen.getByRole("link");
		const row = view.container.querySelector("[data-plan-done]")?.firstElementChild;

		expect({
			href: link.getAttribute("href"),
			text: link.textContent,
			className: link.className,
			row: [...(row?.children ?? [])].map((child) => child.textContent),
			created: view.container.textContent.includes("created"),
		}).toStrictEqual({
			href: "/plan/switch-git-pager",
			text: "Open plan file",
			className: PLAN_FILE_ACTION,
			row: ["Plan approved", "Open plan file"],
			created: false,
		});
	});

	it("puts the plan-file action alone above the block while the plan awaits approval", async () => {
		const view = await renderRenderer(
			makeToolCall({input: {plan: "Do it.", planFilePath: "/Users/craig/.claude/plans/switch-git-pager.md"}}),
		);
		const root = view.container.firstElementChild;

		expect({
			children: [...(root?.children ?? [])].map((child) => child.textContent),
			actionRow: root?.firstElementChild?.className,
			href: screen.getByRole("link").getAttribute("href"),
		}).toStrictEqual({
			children: ["Open plan file", "Do it."],
			actionRow: "flex items-center justify-end gap-2",
			href: "/plan/switch-git-pager",
		});
	});

	it("shows no plan-file action without a saved plan file", async () => {
		await renderRenderer(makeToolCall({input: {plan: "Do it."}, result: "User has approved your plan."}));
		expect(screen.queryByRole("link")).toStrictEqual(null);
	});

	it("shows a genuine tool error's text only in Verbose", async () => {
		const error = "You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first.";
		const call = makeToolCall({input: {plan: "Do it."}, result: error, isError: true});
		const normal = (await renderRenderer(call)).container.textContent.includes(error);
		cleanup();
		const verbose = (await renderRenderer(call, true)).container.textContent.includes(error);

		expect({normal, verbose}).toStrictEqual({normal: false, verbose: true});
	});
});
