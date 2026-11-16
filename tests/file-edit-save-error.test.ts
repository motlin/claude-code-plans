import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {FileSaveError, saveEditableMarkdown, saveFileText} from "../src/lib/api/file-edit";
import type {EditableMarkdownTarget} from "../src/lib/file-edit";

const TARGET: EditableMarkdownTarget =
{
	kind: "plan",
	url: "/api/plans/alpha",
};

afterEach(() =>
{
	vi.unstubAllGlobals();
});

function reply(response: () => Response | Promise<Response>): void
{
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => response()),
	);
}

async function failure(save: () => Promise<unknown>): Promise<unknown>
{
	try
	{
		await save();
	}
	catch (error)
	{
		return error instanceof FileSaveError ? error.error : error;
	}
	return "resolved";
}

const REPLIES: [string, () => Response | Promise<Response>][] = [
	[
		"409 missing",
		() =>
			Response.json(
				{
					reason: "missing",
				},
				{
					status: 409,
				},
			),
	],
	[
		"409 conflict",
		() =>
			Response.json(
				{
					reason: "conflict",
					etag: '"2"',
				},
				{
					status: 409,
					headers:
					{
						ETag: '"2"',
					},
				},
			),
	],
	[
		"403",
		() =>
			Response.json(
				{
					reason: "denied",
				},
				{
					status: 403,
				},
			),
	],
	[
		"500",
		() =>
			new Response(
				"boom",
				{
					status: 500,
				},
			),
	],
	[
		"network",
		() =>
		{
			throw new TypeError("Failed to fetch");
		},
	],
];

const EXPECTED = [
	{
		kind: "missing",
	},
	{
		kind: "conflict",
		etag: '"2"',
	},
	{
		kind: "denied",
	},
	{
		kind: "writeFailed",
		etag: '"1"',
	},
	{
		kind: "writeFailed",
		etag: '"1"',
	},
];

describe("save failures map to upstream's banner kinds", () =>
{
	it("saveEditableMarkdown", async () =>
	{
		const results: unknown[] = [];
		for (const [, response] of REPLIES)
		{
			reply(response);
			results.push(await failure(async () => saveEditableMarkdown(TARGET, "# Mine\n", '"1"')));
		}
		expect(results).toStrictEqual(EXPECTED);
	});

	it("saveFileText", async () =>
	{
		const results: unknown[] = [];
		for (const [, response] of REPLIES)
		{
			reply(response);
			results.push(await failure(async () => saveFileText("/home/alice/proj/a.ts", "mine\n", '"1"')));
		}
		expect(results).toStrictEqual(EXPECTED);
	});

	it("a conflict without a body etag falls back to the ETag header", async () =>
	{
		reply(() =>
			Response.json(
				{
					reason: "conflict",
				},
				{
					status: 409,
					headers:
					{
						ETag: '"3"',
					},
				},
			),
		);
		expect(await failure(async () => saveEditableMarkdown(TARGET, "x", null))).toStrictEqual(
			{
				kind: "conflict",
				etag: '"3"',
			},
		);
	});
});
