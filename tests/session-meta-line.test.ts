import {metaStatus, sessionMetaLine, sessionMetaMessage} from "../src/lib/session-meta-line";

const ccp =
{
	text: "ccp",
	spoken: true,
};

describe("sessionMetaLine", () =>
{
	it("shows only the message and place for an idle row under a status heading", () =>
	{
		expect(
			sessionMetaLine(
				{
					status: "idle",
					underStatusHeading: true,
					message: "Fixed the sidebar",
					place: ccp,
					heading: "Idle",
				},
			),
		).toEqual(
			{
				text: "Fixed the sidebar",
				place: ccp,
			},
		);
	});

	it("shows the Idle word alone for a messageless row under the heading that names its folder", () =>
	{
		expect(
			sessionMetaLine(
				{
					status: "idle",
					underStatusHeading: false,
					place: ccp,
					heading: "ccp",
				},
			),
		).toEqual(
			{
				word: "idle",
			},
		);
	});

	it("shows only the place for a messageless row under a status heading", () =>
	{
		expect(
			sessionMetaLine(
				{
					status: "idle",
					underStatusHeading: true,
					place: ccp,
					heading: "ccp",
				},
			),
		).toEqual(
			{
				place: ccp,
			},
		);
	});

	it("shows the reason without the word for a blocked row under a status heading", () =>
	{
		expect(
			sessionMetaLine(
				{
					status: "blocked",
					underStatusHeading: true,
					reason: "Asked a question",
					message: "Run the tests",
					place: ccp,
					heading: "Needs input",
				},
			),
		).toEqual(
			{
				text: "Asked a question",
				place: ccp,
			},
		);
	});

	it("shows the Waiting word and message, dropping the place the heading names, for a blocked row with no reason", () =>
	{
		expect(
			sessionMetaLine(
				{
					status: "blocked",
					underStatusHeading: false,
					message: "m",
					place: ccp,
					heading: "ccp · main",
				},
			),
		).toEqual(
			{
				word: "blocked",
				text: "m",
			},
		);
	});

	it("shows the Working word and place for a messageless working row under another heading", () =>
	{
		expect(
			sessionMetaLine(
				{
					status: "working",
					underStatusHeading: false,
					place: ccp,
					heading: "Other",
				},
			),
		).toEqual(
			{
				word: "working",
				place: ccp,
			},
		);
	});

	it("hides the word of a non-blocked row that has a message", () =>
	{
		expect(
			sessionMetaLine(
				{
					status: "unread",
					underStatusHeading: false,
					message: "Done it",
					place: ccp,
					heading: "ccp",
				},
			),
		).toEqual(
			{
				text: "Done it",
			},
		);
	});
});

describe("metaStatus", () =>
{
	it("maps buckets to upstream's row statuses", () =>
	{
		const sessions: Parameters<typeof metaStatus>[0][] = [
			{
				bucket: "blocked",
				unseenError: true,
				archived: false,
			},
			{
				bucket: "blocked",
				archived: false,
			},
			{
				bucket: "working",
				archived: false,
			},
			{
				bucket: "review",
				archived: false,
			},
			{
				bucket: "done",
				archived: false,
			},
			{
				bucket: "review",
				archived: true,
			},
		];
		expect(sessions.map((session) => metaStatus(session))).toEqual([
			"error",
			"blocked",
			"working",
			"unread",
			"idle",
			"idle",
		]);
	});
});

describe("sessionMetaMessage", () =>
{
	const session =
	{
		summary: "S",
		lastUserMessage: "L",
	};

	it("uses the summary for settled rows and the last user message otherwise", () =>
	{
		expect(
			(["idle", "unread", "error", "working", "blocked"] as const).map((status) =>
				sessionMetaMessage(session, status),
			),
		).toEqual(["S", "S", "S", "L", "L"]);
	});

	it("falls back to the last user message without a summary", () =>
	{
		expect(
			sessionMetaMessage(
				{
					lastUserMessage: "L",
				},
				"idle",
			),
		).toBe("L");
	});

	it("has no message without either", () =>
	{
		expect(sessionMetaMessage({}, "idle")).toBeUndefined();
	});
});
