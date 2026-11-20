import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {SessionMcpStatusResponse} from "../src/lib/api/sessions";
import {isFailedMcpSnapshot, readSessionMcpStatus} from "../src/lib/session-mcp-status";

function delta(fields: Record<string, unknown>): Record<string, unknown>
{
	return {
		type: "attachment",
		uuid: "a-1",
		attachment:
		{
			type: "deferred_tools_delta",
			...fields,
		},
	};
}

const IMCP_FAILED = delta(
	{
		failedMcpServers: [
			{
				name: "imcp",
				errorCode: "CONNECT_TIMEOUT",
				error: "timed out",
				willRetry: "on_reach",
			},
		],
		pendingMcpServers: [],
	},
);

const PARTIAL = delta(
	{
		addedNames: ["mcp__imcp__weather"],
	},
);

const USER =
{
	type: "user",
	uuid: "u-1",
	message:
	{
		role: "user",
		content: "failedMcpServers is mentioned here",
	},
};

describe("readSessionMcpStatus", () =>
{
	it("reads the last delta that carries failedMcpServers, skipping later partial deltas", () =>
	{
		expect(
			[
				[IMCP_FAILED, PARTIAL, USER],
				[
					IMCP_FAILED,
					delta(
						{
							failedMcpServers: [],
							pendingMcpServers: [],
						},
					),
					PARTIAL,
				],
				[USER, PARTIAL],
				[],
			].map(readSessionMcpStatus),
		).toStrictEqual([
			{
				failed: [
					{
						name: "imcp",
						errorCode: "CONNECT_TIMEOUT",
						error: "timed out",
						willRetry: "on_reach",
					},
				],
			},
			{
				failed: [],
			},
			{
				failed: [],
			},
			{
				failed: [],
			},
		]);
	});

	it("recognises only a full delta as a new snapshot", () =>
	{
		expect([IMCP_FAILED, PARTIAL, USER, null, "x"].map(isFailedMcpSnapshot)).toStrictEqual([
			true,
			false,
			false,
			false,
			false,
		]);
	});
});

type ApiHandler = (context: {
	params:
	{
		id: string;
	};
}) => Response | Promise<Response>;

describe("GET /api/sessions/$id/mcp-status", () =>
{
	let tempDir: string;
	let db: AppDb;

	beforeEach(() =>
	{
		tempDir = mkdtempSync(join(tmpdir(), "session-mcp-status-test-"));
		db = openTestDb();
	});

	afterEach(() =>
	{
		db.close();
		rmSync(
			tempDir,
			{
				recursive: true,
				force: true,
			},
		);
		vi.doUnmock("../src/lib/db");
		vi.resetModules();
	});

	function seedSession(sessionId: string, records: unknown[]): void
	{
		const filePath = join(tempDir, `${sessionId}.jsonl`);
		writeFileSync(filePath, records.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
		db.index
			.insert(schema.sessions)
			.values(
				{
					id: sessionId,
					projectId: "test-project",
					title: sessionId,
					createdAt: 0,
					mtimeMs: 0,
					filePath,
				},
			)
			.run();
	}

	async function getStatus(sessionId: string): Promise<Response>
	{
		vi.doMock("../src/lib/db", () => (
		{
			getDb: () => db,
		}));
		const {Route} = await import("../src/routes/api/sessions.$id.mcp-status");
		const handlers = (
			Route as unknown as
			{
				options:
				{
					server:
					{
						handlers: Record<string, ApiHandler>;
					};
				};
			}
		).options.server.handlers;
		return handlers["GET"]!(
			{
				params:
				{
					id: sessionId,
				},
			},
		);
	}

	it("serves the session's last failed-server snapshot, uncached", async () =>
	{
		seedSession("s1", [USER, IMCP_FAILED, PARTIAL]);
		const response = await getStatus("s1");

		expect(
			{
				body: SessionMcpStatusResponse.parse(await response.json()),
				cacheControl: response.headers.get("Cache-Control"),
			},
		).toStrictEqual(
			{
				body:
				{
					failed: [
						{
							name: "imcp",
							errorCode: "CONNECT_TIMEOUT",
							error: "timed out",
							willRetry: "on_reach",
						},
					],
				},
				cacheControl: "private, max-age=0, must-revalidate",
			},
		);
	});

	it("answers no failures for an unknown session", async () =>
	{
		expect(await (await getStatus("missing")).json()).toStrictEqual(
			{
				failed: [],
			},
		);
	});
});
