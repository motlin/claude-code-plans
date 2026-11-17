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
				heading: list.firstElementChild?.getAttribute("class"),
				text: [...list.children].map((child) => child.textContent),
			};
}

describe("ApprovalAlsoWaiting (upstream c390f938b ui)", () =>
{
	it("lists the queued requests in order under upstream's footnote heading", () =>
	{
		expect(drawn(QUEUED, "card")).toStrictEqual(
			{
				className: "flex flex-col gap-[var(--chat-item-gap)]",
				heading: "text-footnote text-muted-as-secondary",
				text: ["Also waiting", "List files", "use github"],
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
