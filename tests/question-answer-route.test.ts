import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import type {QuestionLike} from "../src/lib/ask-user-question";
import {questionAnswerRoute} from "../src/lib/question-answer-route";
import {responsesToPaneAnswers, submitQuestionAnswer} from "../src/lib/question-answer-submit";
import {labelledAnswers, questionResponses} from "../src/lib/question-card-draft";

const QUESTIONS: QuestionLike[] = [
	{
		question: "Which runner?",
		options: [
			{
				label: "Vitest",
			},
			{
				label: "Jest",
			},
		],
	},
	{
		question: "Which features?",
		multiSelect: true,
		options: [
			{
				label: "Coverage",
			},
			{
				label: "Watch",
			},
			{
				label: "UI",
			},
		],
	},
];

afterEach(() =>
{
	vi.unstubAllGlobals();
});

describe("questionAnswerRoute", () =>
{
	it("answers in the live pane when the session has a writable pane", () =>
	{
		expect(
			questionAnswerRoute(
				{
					live: true,
					hasLivePane: true,
					writesEnabled: true,
				},
			),
		).toBe("live-pane");
	});

	it("is read-only when the session has a pane but terminal writes are disabled", () =>
	{
		expect(
			questionAnswerRoute(
				{
					live: true,
					hasLivePane: true,
					writesEnabled: false,
				},
			),
		).toBe("read-only");
	});

	it("is read-only for a live session without a pane", () =>
	{
		expect(
			questionAnswerRoute(
				{
					live: true,
					hasLivePane: false,
					writesEnabled: true,
				},
			),
		).toBe("read-only");
	});

	it("is read-only while liveness is unknown", () =>
	{
		expect(
			questionAnswerRoute(
				{
					live: null,
					hasLivePane: false,
					writesEnabled: true,
				},
			),
		).toBe("read-only");
	});

	it("is read-only while the pane list is loading", () =>
	{
		expect(
			questionAnswerRoute(
				{
					live: false,
					hasLivePane: null,
					writesEnabled: false,
				},
			),
		).toBe("read-only");
	});

	it("offers the fork only when the session is not running and has no pane", () =>
	{
		expect(
			questionAnswerRoute(
				{
					live: false,
					hasLivePane: false,
					writesEnabled: true,
				},
			),
		).toBe("fork");
	});
});

describe("labelledAnswers", () =>
{
	const TOOLS: QuestionLike[] = [
		{
			question: "Which tool?",
			multiSelect: true,
			options: [
				{
					label: "Hammer",
				},
				{
					label: "Saw",
				},
			],
		},
		{
			question: "Which runner?",
			options: [
				{
					label: "Vitest",
				},
				{
					label: "Jest",
				},
			],
		},
	];

	it("puts Other's text before the picked labels and answers a skip with [No preference]", () =>
	{
		expect(
			labelledAnswers(TOOLS, [
				{
					selected: [0],
					other: "x",
				},
				null,
			]),
		).toStrictEqual([
			{
				question: "Which tool?",
				answer: "x, Hammer",
			},
			{
				question: "Which runner?",
				answer: "[No preference]",
			},
		]);
	});

	it("joins multiple labels in option order", () =>
	{
		expect(
			labelledAnswers(TOOLS, [
				{
					selected: [0, 1],
				},
				{
					selected: [1],
				},
			]),
		).toStrictEqual([
			{
				question: "Which tool?",
				answer: "Hammer, Saw",
			},
			{
				question: "Which runner?",
				answer: "Jest",
			},
		]);
	});
});

describe("questionResponses, as upstream's bt", () =>
{
	const TOOLS: QuestionLike[] = [
		{
			question: "Which tool?",
			multiSelect: true,
			options: [
				{
					label: "Hammer",
				},
				{
					label: "Saw, big",
				},
			],
		},
		{
			question: "Layout",
			options: [
				{
					label: "Grid",
					preview: "<grid/>",
				},
				{
					label: "List",
				},
			],
		},
	];

	it("answers a multi-select with Other first then the picks in option order, and a single-select with its label and preview", () =>
	{
		expect(
			questionResponses(TOOLS, [
				{
					selected: [1, 0],
					other: "x",
				},
				{
					selected: [0],
				},
			]),
		).toStrictEqual([
			{
				question: "Which tool?",
				response: ["x", "Hammer", "Saw, big"],
			},
			{
				question: "Layout",
				response: "Grid",
				preview: "<grid/>",
			},
		]);
	});

	it("answers a skip with [No preference] and leaves out a missing preview", () =>
	{
		expect(
			questionResponses(TOOLS, [
				null,
				{
					selected: [1],
				},
			]),
		).toStrictEqual([
			{
				question: "Which tool?",
				response: "[No preference]",
			},
			{
				question: "Layout",
				response: "List",
			},
		]);
	});

	it("sends an empty Other as Something else", () =>
	{
		expect(
			questionResponses(TOOLS, [
				{
					selected: [],
					other: "",
				},
				{
					selected: [],
					other: "  ",
				},
			]),
		).toStrictEqual([
			{
				question: "Which tool?",
				response: ["Something else"],
			},
			{
				question: "Layout",
				response: "Something else",
			},
		]);
	});
});

describe("responsesToPaneAnswers, as upstream's xt", () =>
{
	const PICKS: QuestionLike[] = [
		{
			question: "Which?",
			multiSelect: true,
			options: [
				{
					label: "Red, bright",
				},
				{
					label: "Blue",
				},
			],
		},
		{
			question: "Pick",
			options: [
				{
					label: "A",
				},
				{
					label: "B",
				},
			],
		},
	];

	it("matches each element of an array response to its label exactly", () =>
	{
		expect(
			responsesToPaneAnswers(PICKS, [
				{
					question: "Which?",
					response: ["Red, bright", "Blue"],
				},
				{
					question: "Pick",
					response: "B",
				},
			]),
		).toStrictEqual([
			{
				selected: [0, 1],
			},
			{
				selected: [1],
			},
		]);
	});

	it("maps [No preference] and a missing response to a skip", () =>
	{
		expect(
			responsesToPaneAnswers(PICKS, [
				{
					question: "Which?",
					response: "[No preference]",
				},
			]),
		).toStrictEqual([null, null]);
	});

	it("sends a response that is no label as Other text, Something else included so the pane types it", () =>
	{
		expect(
			responsesToPaneAnswers(PICKS, [
				{
					question: "Which?",
					response: ["Blue", "Green, dark"],
				},
				{
					question: "Pick",
					response: "Something else",
				},
			]),
		).toStrictEqual([
			{
				selected: [1],
				other: "Green, dark",
			},
			{
				selected: [],
				other: "Something else",
			},
		]);
	});
});

function okFetch()
{
	const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url: string) =>
		Promise.resolve(
			url === "/api/herdr/question"
				? Response.json(
						{
							ok: true,
						},
					)
				: new Response(
						"",
						{
							status: 200,
						},
					),
		),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const SUBMISSION =
{
	sessionId: "s1",
	toolUseId: "toolu_1",
	questions: QUESTIONS,
	picks: [
		{
			selected: [0],
		},
		{
			selected: [2],
			other: "Watch",
		},
	],
};

describe("submitQuestionAnswer", () =>
{
	it("types a live-pane answer's picks into the session's herdr pane as they are, Other text that names a label included", async () =>
	{
		const fetchMock = okFetch();
		await submitQuestionAnswer("live-pane", SUBMISSION);
		expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.body])).toStrictEqual([
			[
				"/api/herdr/question",
				JSON.stringify(
					{
						sessionId: "s1",
						toolUseId: "toolu_1",
						answers: [
							{
								selected: [0],
							},
							{
								selected: [2],
								other: "Watch",
							},
						],
					},
				),
			],
		]);
	});

	it("resumes a fork only on the fork route", async () =>
	{
		const fetchMock = okFetch();
		await submitQuestionAnswer("fork", SUBMISSION);
		expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.body])).toStrictEqual([
			[
				"/api/answer-question",
				JSON.stringify(
					{
						sessionId: "s1",
						toolUseId: "toolu_1",
						answers: [
							{
								question: "Which runner?",
								response: "Vitest",
							},
							{
								question: "Which features?",
								response: ["Watch", "UI"],
							},
						],
					},
				),
			],
		]);
	});

	it("types a free-text reply into the pane by its label", async () =>
	{
		const fetchMock = okFetch();
		await submitQuestionAnswer(
			"live-pane",
			{
				sessionId: "s1",
				toolUseId: "toolu_1",
				questions: QUESTIONS,
				responses: [
					{
						question: "Which runner?",
						response: "Jest",
					},
				],
			},
		);
		expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.body])).toStrictEqual([
			[
				"/api/herdr/question",
				JSON.stringify(
					{
						sessionId: "s1",
						toolUseId: "toolu_1",
						answers: [
							{
								selected: [1],
							},
							null,
						],
					},
				),
			],
		]);
	});

	it("refuses a read-only answer without posting anything", async () =>
	{
		const fetchMock = okFetch();
		await expect(submitQuestionAnswer("read-only", SUBMISSION)).rejects.toThrow("Answer in the terminal");
		expect(fetchMock.mock.calls).toStrictEqual([]);
	});
});
