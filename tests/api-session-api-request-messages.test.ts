import {describe, expect, it, vi, beforeEach, afterEach} from "vite-plus/test";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {jsonlRecordFixtures} from "./fixtures/jsonl-records";

/**
 * Tests for `/api/sessions/$id/api-requests/$requestId`: the messages one API
 * request appended (its `tail`), read lazily by hash when the Request
 * disclosure's Messages section opens.
 */

type ApiHandler = (context: {
	params:
	{
		id: string;
		requestId: string;
	};
}) => Response | Promise<Response>;

let tempDir: string;
let db: AppDb;

beforeEach(() =>
{
	tempDir = mkdtempSync(join(tmpdir(), "api-session-api-request-messages-test-"));
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

async function getMessages(sessionId: string, requestId: string): Promise<unknown>
{
	vi.doMock("../src/lib/db", () => (
	{
		getDb: () => db,
	}));
	const {Route} = await import("../src/routes/api/sessions.$id.api-requests.$requestId");
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
	return (
		await handlers["GET"]!(
			{
				params:
				{
					id: sessionId,
					requestId,
				},
			},
		)
	).json();
}

function seedSession(sessionId: string, records: unknown[]): void
{
	const filePath = join(tempDir, `${sessionId}.jsonl`);
	writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
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

function blob(hash: string, message: unknown)
{
	return {
		type: "api-request-blob",
		sessionId: "session-alice-100",
		hash,
		message,
	};
}

const request = jsonlRecordFixtures["api-request"];

describe("GET /api/sessions/$id/api-requests/$requestId", () =>
{
	it("serves the request's tail messages in tail order, summarizing every block type", async () =>
	{
		seedSession("s", [
			blob(
				"h-kept",
				{
					role: "user",
					content: "Kept from the base request.",
				},
			),
			blob(
				"h-assistant",
				{
					role: "assistant",
					output_config:
					{
						effort: "medium",
					},
					content: [
						{
							type: "thinking",
							thinking: "Plan.",
							signature: "sig",
						},
						{
							type: "text",
							text: "Reading.",
						},
						{
							type: "tool_use",
							id: "toolu_1",
							name: "Read",
							input:
							{
								file_path: "/a",
							},
							caller:
							{
								type: "direct",
							},
						},
					],
				},
			),
			blob(
				"h-user",
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_1",
							content: "ok",
							is_error: false,
						},
						{
							type: "tool_result",
							tool_use_id: "toolu_2",
							content: [
								{
									type: "text",
									text: "Screenshot:",
								},
								{
									type: "image",
									source:
									{
										type: "base64",
										media_type: "image/png",
										data: "AAAA",
									},
								},
							],
							is_error: true,
						},
						{
							type: "tool_addition",
							tool:
							{
								type: "tool_reference",
								name: "mcp__docs__guide",
							},
						},
						{
							type: "tool_addition",
							tool:
							{
								type: "tool_definition",
								definition:
								{
									name: "mcp__docs__update",
									input_schema:
									{
										type: "object",
										properties: {},
									},
								},
							},
						},
						{
							type: "tool_removal",
							tool:
							{
								type: "tool_reference",
								name: "mcp__docs__batch",
							},
						},
						{
							type: "text",
							text: "I got [Image #1]",
						},
						{
							type: "image",
							source:
							{
								type: "base64",
								media_type: "image/jpeg",
								data: "BBBB",
							},
						},
					],
				},
			),
			{
				not: "a blob",
			},
			{
				...request,
				id: "other",
				tail: ["h-kept"],
			},
			{
				...request,
				id: "r1",
				keep: 1,
				tail: ["h-user", "h-assistant", "h-gone"],
			},
		]);
		expect(await getMessages("s", "r1")).toStrictEqual(
			{
				found: true,
				messages: [
					{
						hash: "h-user",
						role: "user",
						blocks: [
							{
								type: "tool_result",
								toolUseId: "toolu_1",
								isError: false,
								text: "ok",
								images: [],
							},
							{
								type: "tool_result",
								toolUseId: "toolu_2",
								isError: true,
								text: "Screenshot:",
								images: [
									{
										mediaType: "image/png",
										data: "AAAA",
									},
								],
							},
							{
								type: "tool_addition",
								name: "mcp__docs__guide",
								definition: false,
							},
							{
								type: "tool_addition",
								name: "mcp__docs__update",
								definition: true,
							},
							{
								type: "tool_removal",
								name: "mcp__docs__batch",
							},
							{
								type: "text",
								text: "I got [Image #1]",
							},
							{
								type: "image",
								mediaType: "image/jpeg",
								data: "BBBB",
							},
						],
					},
					{
						hash: "h-assistant",
						role: "assistant",
						blocks: [
							{
								type: "thinking",
								text: "Plan.",
							},
							{
								type: "text",
								text: "Reading.",
							},
							{
								type: "tool_use",
								id: "toolu_1",
								name: "Read",
								input: '{\n  "file_path": "/a"\n}',
							},
						],
					},
				],
				missing: ["h-gone"],
			},
		);
	});

	it("turns string message content into one text block", async () =>
	{
		seedSession("s", [
			blob(
				"h1",
				{
					role: "system",
					content: "Reminder.",
				},
			),
			{
				...request,
				id: "r1",
				tail: ["h1"],
			},
		]);
		expect(await getMessages("s", "r1")).toStrictEqual(
			{
				found: true,
				messages: [
					{
						hash: "h1",
						role: "system",
						blocks: [
							{
								type: "text",
								text: "Reminder.",
							},
						],
					},
				],
				missing: [],
			},
		);
	});

	it("resolves tail hashes with no blob to the transcript records the CLI hashed instead", async () =>
	{
		// Records copied from a real 2.1.314 session (only `message.role`/`id`/`content` feed the hash), with the
		// real requests' tails: the CLI writes a blob only for a message whose hash its transcript doesn't already
		// cover, hashing each consecutive run of same-role records (same message id for assistants) as one message.
		const assistantText =
		{
			type: "assistant",
			message:
			{
				role: "assistant",
				id: "msg_011CgWLTJFxhUHDVSW6PunyX",
				content: [
					{
						type: "text",
						text: 'Task completed successfully: 7e6757bf is good. Starting task: "Fix React error #185".',
					},
				],
			},
		};
		const assistantToolUse =
		{
			type: "assistant",
			message:
			{
				role: "assistant",
				id: "msg_011CgWLTJFxhUHDVSW6PunyX",
				content: [
					{
						type: "tool_use",
						id: "toolu_01FWkWZnm4ojFjQ8V2LSJY4M",
						name: "Agent",
						input:
						{
							description: "Do one task: React #185 fix",
							prompt: "Follow the markdown-tasks:do-one-task skill.",
						},
						caller:
						{
							type: "direct",
						},
					},
				],
			},
		};
		const monitorResult =
		{
			type: "user",
			message:
			{
				role: "user",
				content: [
					{
						tool_use_id: "toolu_01828Eas8TULx3v5xB4JhvHD",
						type: "tool_result",
						content:
							"Monitor started (task bv9cxjw8j, expires in 30m unless the source ends first; you get one notice at expiry — re-arm if you still need the watch). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.",
					},
				],
			},
		};
		const curlResult =
		{
			type: "user",
			message:
			{
				role: "user",
				content: [
					{
						tool_use_id: "toolu_01PJEAMo71V6ddTwDEKPAcHN",
						type: "tool_result",
						content: "200",
						is_error: false,
					},
				],
			},
		};
		const assistantHash = "af26fd184cf244206280c2d8e9da8a8319011a3769afa9022fd9f7afe48603fa";
		const userHash = "d9515b0c43cf054dba4438f6dc222b88010a9af1ac91c58777a6e7eec455095f";
		const unlogged = "14be5fd51e3175088905193456cb0e56a7a5c4fed2cb55069984c1a5dca7f112";
		seedSession("s", [
			assistantText,
			{
				type: "attachment",
				attachment:
				{
					type: "todo_reminder",
				},
			},
			assistantToolUse,
			monitorResult,
			curlResult,
			{
				...request,
				id: "r1",
				tail: [assistantHash, unlogged],
			},
			{
				...request,
				id: "r2",
				tail: [userHash],
			},
		]);
		expect(await getMessages("s", "r1")).toStrictEqual(
			{
				found: true,
				messages: [
					{
						hash: assistantHash,
						role: "assistant",
						blocks: [
							{
								type: "text",
								text: assistantText.message.content[0]!.text,
							},
							{
								type: "tool_use",
								id: "toolu_01FWkWZnm4ojFjQ8V2LSJY4M",
								name: "Agent",
								input: JSON.stringify(assistantToolUse.message.content[0]!.input, null, 2),
							},
						],
					},
				],
				missing: [unlogged],
			},
		);
		expect(await getMessages("s", "r2")).toStrictEqual(
			{
				found: true,
				messages: [
					{
						hash: userHash,
						role: "user",
						blocks: [
							{
								type: "tool_result",
								toolUseId: "toolu_01828Eas8TULx3v5xB4JhvHD",
								isError: false,
								text: monitorResult.message.content[0]!.content,
								images: [],
							},
							{
								type: "tool_result",
								toolUseId: "toolu_01PJEAMo71V6ddTwDEKPAcHN",
								isError: false,
								text: "200",
								images: [],
							},
						],
					},
				],
				missing: [],
			},
		);
	});

	it("reports an unlogged request as not found", async () =>
	{
		seedSession("s", [
			blob(
				"h1",
				{
					role: "user",
					content: "hi",
				},
			),
			request,
		]);
		expect(await getMessages("s", "nope")).toStrictEqual(
			{
				found: false,
				messages: [],
				missing: [],
			},
		);
	});

	it("reports an unknown session as not found", async () =>
	{
		expect(await getMessages("missing", "r1")).toStrictEqual(
			{
				found: false,
				messages: [],
				missing: [],
			},
		);
	});
});
