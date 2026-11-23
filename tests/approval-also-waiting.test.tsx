// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ApprovalAlsoWaiting} from "../src/components/approval-also-waiting";
import type {QueuedApproval} from "../src/lib/approval-queue";

afterEach(cleanup);

const QUEUED: QueuedApproval[] = [
	{
		id: "ask:2",
		kind: "tool",
		name: "Bash",
		input:
		{
			command: "ls",
			description: "List files",
		},
		createdAt: 2,
	},
	{
		id: "elicitation:e1",
		kind: "elicitation",
		name: "use github",
		createdAt: 3,
	},
	{
		id: "question:q1",
		kind: "question",
		name: "AskUserQuestion",
		input:
		{
			questions: [
				{
					header: "Color",
					question: "Which color?",
				},
			],
		},
		createdAt: 4,
	},
	{
		id: "question:q2",
		kind: "hook-question",
		name: "AskUserQuestion",
		input:
		{
			questions: [
				{
					header: "Fruit",
				},
				{
					header: "Size",
				},
			],
		},
		createdAt: 5,
	},
];

function drawn(queued: QueuedApproval[], presentation: "card" | "dock")
{
	const {container} = render(<ApprovalAlsoWaiting queued={queued} presentation={presentation} />);
	const list = container.firstElementChild;
	return list === null
		? null
		:
			{
				className: list.getAttribute("class"),
				children: [...list.children].map((child) => child.getAttribute("class")),
				rows: [...list.querySelectorAll("[data-approval-queued]")].map((step) =>
				{
					const row = step.querySelector("[data-cds-row]");
					const toggle = row?.querySelector("button[data-cds-row-toggle]");
					return {
						cds: step.getAttribute("data-cds"),
						state: step.getAttribute("data-state"),
						closed: step.getAttribute("data-closed"),
						title: row?.getAttribute("data-cds-row-title"),
						text: row?.textContent,
						expanded: toggle?.getAttribute("aria-expanded"),
					};
				}),
			};
}

function step(title: string)
{
	return {
		cds: "TurnStatusStep",
		state: "blocked",
		closed: "",
		title,
		text: `${title}Needs approval`,
		expanded: "false",
	};
}

describe("ApprovalAlsoWaiting (upstream c390f938b ui)", () =>
{
	it("lists the queued requests in order under upstream's footnote heading", () =>
	{
		expect(drawn(QUEUED, "card")).toStrictEqual(
			{
				className: "flex flex-col gap-[var(--chat-item-gap)]",
				// Upstream wraps the rows in one full-width column under the footnote.
				children: ["text-footnote text-muted-as-secondary", "flex flex-col w-full"],
				rows: [step("List files"), step("use github"), step("Asked “Color”"), step("Asked 2 questions")],
			},
		);
	});

	it("draws nothing with no queued request, or while docked (the dock shows ghosts instead)", () =>
	{
		expect(
			{
				empty: drawn([], "card"),
				docked: drawn(QUEUED, "dock"),
			},
		).toStrictEqual(
			{
				empty: null,
				docked: null,
			},
		);
	});
});
