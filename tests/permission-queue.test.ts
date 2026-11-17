import {describe, expect, it} from "vite-plus/test";
import {PERMISSION_HEAD, permissionQueue, withPermissionAsk, withoutPermissionAsk} from "../src/lib/permission-queue";
import type {PermissionAskEntry} from "../src/lib/permission-ask";

function ask(url: string, receivedAt: number, agentId: string | null = null): PermissionAskEntry
{
	return {
		toolName: "WebFetch",
		toolInput:
		{
			url,
		},
		agentId,
		receivedAt,
	};
}

function webFetch(id: string, url: string)
{
	return {
		type: "assistant",
		message:
		{
			content: [
				{
					type: "tool_use",
					id,
					name: "WebFetch",
					input:
					{
						url,
					},
				},
			],
		},
	};
}

function rejected(id: string)
{
	return {
		type: "user",
		message:
		{
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					content: "The user doesn't want to proceed with this tool use.",
					is_error: true,
				},
			],
		},
	};
}

const A = ask("https://a", 1);
const B = ask("https://b", 2);

describe("permission ask list", () =>
{
	it("appends asks, skips one that is still open, and removes the one a hook resolves", () =>
	{
		const two = withPermissionAsk(withPermissionAsk([], A), B);
		const again = withPermissionAsk(two, ask("https://a", 9));
		const subagent = withPermissionAsk(two, ask("https://a", 3, "x"));
		expect(
			{
				two,
				again,
				resolved: withoutPermissionAsk(
					two,
					{
						toolName: "WebFetch",
						toolInput:
						{
							url: "https://a",
						},
						agentId: null,
					},
				),
				// A main-thread result never resolves a subagent's ask with the same input.
				mainResult: withoutPermissionAsk(
					[ask("https://a", 3, "x")],
					{
						toolName: "WebFetch",
						toolInput:
						{
							url: "https://a",
						},
						agentId: null,
					},
				),
				subagent,
			},
		).toStrictEqual(
			{
				two: [A, B],
				again: [A, B],
				resolved: [B],
				mainResult: [ask("https://a", 3, "x")],
				subagent: [A, B, ask("https://a", 3, "x")],
			},
		);
	});
});

describe("permissionQueue", () =>
{
	it("heads the CLI's visible dialog and counts the others", () =>
	{
		expect(
			{
				head: PERMISSION_HEAD,
				queue: permissionQueue([A, B], [webFetch("f1", "https://a"), webFetch("f2", "https://b")]),
			},
		).toStrictEqual(
			{
				head: "oldest",
				queue:
				{
					head: A,
					queued: [B],
					queueDepth: 1,
				},
			},
		);
	});

	it("drops an ask whose call already has a result, such as a user denial that fired no hook", () =>
	{
		expect(
			permissionQueue([A, B], [webFetch("f1", "https://a"), webFetch("f2", "https://b"), rejected("f1")]),
		).toStrictEqual(
			{
				head: B,
				queued: [],
				queueDepth: 0,
			},
		);
	});

	it("keeps an ask no main-thread call describes, such as a subagent's", () =>
	{
		const subagent = ask("https://c", 3, "x");
		expect(permissionQueue([subagent], [webFetch("f1", "https://c"), rejected("f1")])).toStrictEqual(
			{
				head: subagent,
				queued: [],
				queueDepth: 0,
			},
		);
	});

	it("is empty with no asks", () =>
	{
		expect(permissionQueue([], [])).toStrictEqual(
			{
				head: null,
				queued: [],
				queueDepth: 0,
			},
		);
	});
});
