import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {readSessionUsageStats} from "../src/lib/session-usage-accumulator";
import {SessionUsageStatsSchema} from "../src/lib/session-usage-stats";
import {handleUsageStatsRequest} from "../src/routes/api/sessions.$id.usage-stats";

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

describe("GET /api/sessions/$id/usage-stats", () =>
{
	it("answers the transcript's stats in the strict schema", async () =>
	{
		const root = mkdtempSync(join(tmpdir(), "usage-stats-route-"));
		roots.push(root);
		const transcript = join(root, "session.jsonl");
		writeFileSync(
			transcript,
			[
				{
					type: "assistant",
					message:
					{
						id: "m1",
						model: "claude-opus-5-5",
						content: [],
						usage:
						{
							input_tokens: 3,
							output_tokens: 4,
							cache_read_input_tokens: 5,
							cache_creation_input_tokens: 6,
						},
					},
				},
				{
					type: "cost-state",
					totalCostUSD: 0.25,
					totalAPIDuration: 1000,
					totalDuration: 2000,
					modelUsage:
					{
						"claude-opus-5-5":
						{
							costUSD: 0.25,
						},
					},
				},
			]
				.map((record) => JSON.stringify(record))
				.join("\n"),
		);

		const response = await handleUsageStatsRequest(transcript);

		expect(
			{
				status: response.status,
				body: SessionUsageStatsSchema.parse(await response.json()),
			},
		).toStrictEqual(
			{
				status: 200,
				body: await readSessionUsageStats(transcript),
			},
		);
	});

	it("answers 404 for an unknown session", async () =>
	{
		const response = await handleUsageStatsRequest(undefined);

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
