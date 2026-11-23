import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {SessionStatusInfoResponse} from "../src/lib/api/sessions";
import {readSessionStatusInfo} from "../src/lib/session-status-info";
import {handleStatusInfoRequest} from "../src/routes/api/sessions.$id.status-info";

const roots: string[] = [];

afterEach(() =>
{
	for (const root of roots.splice(0))
		rmSync(
			root,
			{
				recursive: true,
				force: true,
			},
		);
});

function fixture():
{
	root: string;
	home: string;
	project: string;
	transcript: string;
}
{
	const root = mkdtempSync(join(tmpdir(), "status-info-"));
	roots.push(root);
	const home = join(root, "home");
	const project = join(root, "project");
	mkdirSync(
		join(home, ".claude"),
		{
			recursive: true,
		},
	);
	mkdirSync(
		join(project, ".claude"),
		{
			recursive: true,
		},
	);
	return {
		root,
		home,
		project,
		transcript: join(root, "session.jsonl"),
	};
}

function writeJson(path: string, value: unknown): void
{
	writeFileSync(path, JSON.stringify(value));
}

describe("readSessionStatusInfo", () =>
{
	it("reads the newest CLI version, first timestamp and cwd, a fork, and merged additional folders", async () =>
	{
		const {home, project, transcript} = fixture();
		writeFileSync(
			transcript,
			[
				JSON.stringify(
					{
						type: "summary",
						summary: "no timestamp here",
					},
				),
				JSON.stringify(
					{
						type: "user",
						uuid: "u-1",
						cwd: project,
						version: "2.1.300",
						timestamp: "2026-11-06T10:00:00.000Z",
						forkedFrom:
						{
							sessionId: "parent",
						},
						message:
						{
							role: "user",
							content: 'say "version":"9.9.9" please',
						},
					},
				),
				"{not json",
				JSON.stringify(
					{
						type: "data-flow-incomplete",
						v: 1,
						sessionId: "s-1",
						codes: [1],
					},
				),
				JSON.stringify(
					{
						type: "data-flow-incomplete",
						v: 1,
						sessionId: "s-1",
						codes: [9, 4],
					},
				),
				JSON.stringify(
					{
						type: "attachment",
						uuid: "d-1",
						attachment:
						{
							type: "deferred_tools_delta",
							addedNames: ["mcp__sentry__search", "WebFetch"],
							failedMcpServers: [
								{
									name: "imcp",
									errorCode: "CONNECT_TIMEOUT",
								},
							],
							pendingMcpServers: [],
						},
					},
				),
				JSON.stringify(
					{
						type: "assistant",
						uuid: "a-1",
						cwd: join(project, "sub"),
						version: "2.1.326",
						timestamp: "2026-11-06T10:05:00.000Z",
					},
				),
				"",
			].join("\n"),
		);
		writeJson(
			join(home, ".claude", "settings.json"),
			{
				permissions:
				{
					additionalDirectories: ["/shared/a", "/shared/b"],
				},
			},
		);
		writeJson(
			join(project, ".claude", "settings.json"),
			{
				additionalDirectories: ["/shared/b", "/project/c"],
			},
		);
		writeJson(
			join(project, ".claude", "settings.local.json"),
			{
				permissions:
				{
					additionalDirectories: ["/local/d", "/shared/a"],
				},
			},
		);

		const info = await readSessionStatusInfo(
			transcript,
			{
				home,
			},
		);

		expect(SessionStatusInfoResponse.parse(info)).toStrictEqual(
			{
				cliVersion: "2.1.326",
				createdAt: Date.parse("2026-11-06T10:00:00.000Z"),
				forked: true,
				cwd: project,
				homePath: home,
				additionalDirectories: ["/shared/a", "/shared/b", "/project/c", "/local/d"],
				mcpStatuses: [
					["sentry", "connected"],
					["imcp", "failed"],
				],
				dataFlowIncompleteCodes: [9, 4],
			},
		);
	});

	it("reports nothing it can't read: a missing transcript and settings", async () =>
	{
		const {home, transcript} = fixture();

		expect(
			await readSessionStatusInfo(
				transcript,
				{
					home,
				},
			),
		).toStrictEqual(
			{
				cliVersion: null,
				createdAt: null,
				forked: false,
				cwd: null,
				homePath: home,
				additionalDirectories: [],
				mcpStatuses: null,
				dataFlowIncompleteCodes: null,
			},
		);
	});

	it("answers 404 for a session the index doesn't know", async () =>
	{
		const response = await handleStatusInfoRequest(undefined, "/home/x");

		expect(
			{
				status: response.status,
				body: await response.text(),
			},
		).toStrictEqual(
			{
				status: 404,
				body: "Session not found",
			},
		);
	});
});
