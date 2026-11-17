import {describe, expect, it} from "vite-plus/test";
import type {SessionListItem} from "../src/lib/api/sessions";
import {parseSessionLinkHref, sessionChipModel, sessionLinkTarget} from "../src/lib/session-link-href";

const UUID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

describe("parseSessionLinkHref", () =>
{
	it("parses upstream's claude.ai session URLs and session fragments", () =>
	{
		expect([
			parseSessionLinkHref("https://claude.ai/code/session_01AbCdEf"),
			parseSessionLinkHref("https://claude.ai/code/session/cse_012345"),
			parseSessionLinkHref("https://claude.ai/code/ses_012345?artifact=a1#top"),
			parseSessionLinkHref("#session_01AbCdEf"),
		]).toStrictEqual([
			{
				id: "session_01AbCdEf",
				kind: "session",
				isFragment: false,
			},
			{
				id: "cse_012345",
				kind: "session",
				isFragment: false,
			},
			{
				id: "ses_012345",
				kind: "session",
				isFragment: false,
			},
			{
				id: "session_01AbCdEf",
				kind: "session",
				isFragment: true,
			},
		]);
	});

	it("parses local session routes, on a localhost origin or the app's own", () =>
	{
		const local =
		{
			id: UUID,
			kind: "local",
			isFragment: false,
		};
		expect([
			parseSessionLinkHref(`/session/${UUID}`),
			parseSessionLinkHref(`http://localhost:7526/session/${UUID}`),
			parseSessionLinkHref(`http://127.0.0.1:7591/session/${UUID}?pane=files`),
			parseSessionLinkHref(`https://box.tail.ts.net/session/${UUID}`, "https://box.tail.ts.net"),
		]).toStrictEqual([local, local, local, local]);
	});

	it("rejects thread, desktop-local, short and foreign links", () =>
	{
		expect([
			parseSessionLinkHref("#local_abc"),
			parseSessionLinkHref("#cmsg_0123456"),
			parseSessionLinkHref("https://claude.ai/code/session_01"),
			parseSessionLinkHref("https://evil.test/code/session_01AbCdEf"),
			parseSessionLinkHref(`https://box.tail.ts.net/session/${UUID}`),
			parseSessionLinkHref("/session/not-a-uuid"),
			parseSessionLinkHref("https://github.com/o/r/pull/1"),
		]).toStrictEqual([null, null, null, null, null, null, null]);
	});
});

describe("sessionChipModel", () =>
{
	const links = new Map([
		[
			"session_01AbCdEf",
			{
				localId: "u1",
				title: "Fix bug",
				state: "running" as const,
			},
		],
	]);

	it("routes a bridged session in-app with its title, state and open marker", () =>
	{
		expect(sessionChipModel("https://claude.ai/code/session_01AbCdEf", "x", links, "u1")).toStrictEqual(
			{
				sessionId: "u1",
				internalTo: "/session/u1",
				title: "Fix bug",
				state: "running",
				isOpen: true,
				label: "x",
			},
		);
	});

	it("routes an unindexed local session in-app labelled by its text", () =>
	{
		expect(sessionChipModel(`/session/${UUID}`, "that one", links, "u1")).toStrictEqual(
			{
				sessionId: UUID,
				internalTo: `/session/${UUID}`,
				isOpen: false,
				label: "that one",
			},
		);
	});

	it("leaves an unresolved claude.ai session as an external chip, a fragment pointing at claude.ai", () =>
	{
		expect([
			sessionChipModel("https://claude.ai/code/session_01ZZZZZZ", "x", links, "u1"),
			sessionChipModel("#cse_0123456", "#cse_0123456", links, "u1"),
		]).toStrictEqual([
			{
				sessionId: "session_01ZZZZZZ",
				href: "https://claude.ai/code/session_01ZZZZZZ",
				isOpen: false,
				label: "x",
			},
			{
				sessionId: "cse_0123456",
				href: "https://claude.ai/code/cse_0123456",
				isOpen: false,
				label: "#cse_0123456",
			},
		]);
	});

	it("is null for a link that names no session", () =>
	{
		expect(sessionChipModel("https://example.test/", "x", links, "u1")).toBe(null);
	});
});

describe("sessionLinkTarget", () =>
{
	const row: SessionListItem =
	{
		id: "u1",
		title: "Fix bug",
		mtime: "2026-09-28T10:00:00.000Z",
		created: "2026-09-28T09:00:00.000Z",
		project: "-projects-alpha",
		projectName: "alpha",
		messageCount: 4,
		archived: false,
		state: "working",
		bucket: "working",
		liveAgentCount: 0,
		unseen: false,
		blockedSince: null,
		prStatus:
		{
			number: 12,
			state: "open",
			url: "https://github.com/o/r/pull/12",
		},
	};

	it("takes the row's title, state kind, sidebar status word and PR", () =>
	{
		expect([
			sessionLinkTarget(row),
			sessionLinkTarget(
				{
					...row,
					bucket: "blocked",
					prStatus: undefined,
				},
			),
			sessionLinkTarget(
				{
					...row,
					archived: true,
					bucket: "done",
					prStatus: undefined,
				},
			),
		]).toStrictEqual([
			{
				localId: "u1",
				title: "Fix bug",
				state: "running",
				status: "Working",
				pr:
				{
					number: 12,
					state: "open",
				},
			},
			{
				localId: "u1",
				title: "Fix bug",
				state: "awaiting",
				status: "Needs input",
			},
			{
				localId: "u1",
				title: "Fix bug",
				state: "archived",
				status: "Archived",
			},
		]);
	});
});
