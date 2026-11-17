import {describe, expect, it} from "vite-plus/test";
import {approvalQueue, sessionApprovalQueue, type QueuedApproval} from "../src/lib/approval-queue";

const TOOL: QueuedApproval =
{
	id: "permission:t1",
	kind: "tool",
	name: "Bash",
	createdAt: 2,
};

const ELICITATION: QueuedApproval =
{
	id: "elicitation:e1",
	kind: "elicitation",
	name: "use github",
	createdAt: 1,
};

describe("approvalQueue", () =>
{
	it("has no head and no depth when nothing is pending", () =>
	{
		expect(approvalQueue([])).toStrictEqual(
			{
				head: null,
				queued: [],
				queueDepth: 0,
			},
		);
	});

	it("heads a single request with depth 0", () =>
	{
		expect(approvalQueue([TOOL])).toStrictEqual(
			{
				head: TOOL,
				queued: [],
				queueDepth: 0,
			},
		);
	});

	it("heads the oldest request and queues the rest (upstream Ls/Ek/ES)", () =>
	{
		expect(approvalQueue([TOOL, ELICITATION])).toStrictEqual(
			{
				head: ELICITATION,
				queued: [TOOL],
				queueDepth: 1,
			},
		);
	});

	it("skips an out-of-turn request for the head, falling back to the first when every one is", () =>
	{
		const outOfTurn: QueuedApproval =
		{
			...ELICITATION,
			outOfTurn: true,
		};
		expect(
			{
				mixed: approvalQueue([outOfTurn, TOOL]),
				allOut: approvalQueue([outOfTurn]),
			},
		).toStrictEqual(
			{
				mixed:
				{
					head: TOOL,
					queued: [outOfTurn],
					queueDepth: 1,
				},
				allOut:
				{
					head: outOfTurn,
					queued: [],
					queueDepth: 0,
				},
			},
		);
	});

	it("counts every other pending request, whatever its kind", () =>
	{
		const question: QueuedApproval =
		{
			id: "question:q1",
			kind: "hook-question",
			name: "Question",
			createdAt: 3,
		};
		const plan: QueuedApproval =
		{
			id: "plan:p1",
			kind: "plan",
			name: "ExitPlanMode",
			createdAt: 3,
		};
		expect(approvalQueue([plan, TOOL, question, ELICITATION])).toStrictEqual(
			{
				head: ELICITATION,
				// A stable sort keeps the plan before the question it ties with.
				queued: [TOOL, plan, question],
				queueDepth: 3,
			},
		);
	});
});

describe("sessionApprovalQueue", () =>
{
	const ask = (toolName: string, toolInput: Record<string, unknown>, receivedAt: number) => (
	{
		toolName,
		toolInput,
		agentId: null,
		receivedAt,
	});

	it("heads the oldest drawable card and queues every other request, drawable or not", () =>
	{
		const queue = sessionApprovalQueue(
			{
				asks: [
					ask(
						"WebFetch",
						{
							url: "https://b",
						},
						1,
					),
					ask(
						"Bash",
						{
							command: "ls",
						},
						5,
					),
				],
				records: [],
				permissionKey: "toolu_1",
				elicitations: [
					{
						key: "e1",
						serverName: "github",
						receivedAt: 3,
					},
					{
						key: "e2",
						serverName: "linear",
						receivedAt: 9,
					},
				],
				planId: null,
				hookQuestionId: null,
				transcriptQuestionId: null,
			},
		);
		expect(queue).toStrictEqual(
			{
				head:
				{
					id: "permission:toolu_1",
					kind: "tool",
					name: "WebFetch",
					input:
					{
						url: "https://b",
					},
					createdAt: 1,
				},
				queued: [
					{
						id: "elicitation:e1",
						kind: "elicitation",
						name: "use github",
						createdAt: 3,
					},
					{
						id: "ask:5:1",
						kind: "tool",
						name: "Bash",
						input:
						{
							command: "ls",
						},
						createdAt: 5,
					},
					{
						id: "elicitation:e2",
						kind: "elicitation",
						name: "use linear",
						createdAt: 9,
					},
				],
				queueDepth: 3,
			},
		);
	});

	it("heads a hook question asked before the permission, and dates a card no ask describes first", () =>
	{
		const asks = [
			ask(
				"AskUserQuestion",
				{
					questions: [],
				},
				1,
			),
			ask(
				"Bash",
				{
					command: "ls",
				},
				2,
			),
		];
		const base =
		{
			asks,
			records: [],
			elicitations: [],
			planId: null,
			transcriptQuestionId: null,
		};
		expect(
			{
				question: sessionApprovalQueue(
					{
						...base,
						permissionKey: "toolu_1",
						hookQuestionId: "toolu_q",
					},
				).head?.id,
				// An answered permission leaves the question to head; its ask still counts until the hook resolves it.
				answered: sessionApprovalQueue(
					{
						...base,
						permissionKey: null,
						hookQuestionId: "toolu_q",
					},
				),
				noAsks: sessionApprovalQueue(
					{
						...base,
						asks: [],
						permissionKey: "toolu_1",
						hookQuestionId: "toolu_q",
					},
				).head?.id,
			},
		).toStrictEqual(
			{
				question: "question:toolu_q",
				answered:
				{
					head:
					{
						id: "question:toolu_q",
						kind: "hook-question",
						name: "Question",
						createdAt: 1,
					},
					queued: [],
					queueDepth: 0,
				},
				noAsks: "permission:toolu_1",
			},
		);
	});
});
