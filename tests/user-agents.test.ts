import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {agentMentionOptions} from "../src/lib/api/user-agents";
import {readUserAgents} from "../src/lib/user-agents";

describe("readUserAgents", () =>
{
	let dir: string;

	beforeEach(async () =>
	{
		dir = await mkdtemp(join(tmpdir(), "ccp-agents-"));
	});

	afterEach(async () =>
	{
		await rm(
			dir,
			{
				recursive: true,
				force: true,
			},
		);
	});

	it("reads each agent file's frontmatter name and description, skipping files without a name", async () =>
	{
		await writeFile(join(dir, "code-reviewer.md"), "---\nname: code-reviewer\ndescription: Reviews\n---\nPrompt");
		await writeFile(join(dir, "nameless.md"), "---\ndescription: No name\n---\nPrompt");
		await writeFile(join(dir, "notes.txt"), "---\nname: notes\n---\n");
		await mkdir(join(dir, "nested"));

		expect(
			{
				agents: await readUserAgents(dir),
				missing: await readUserAgents(join(dir, "absent")),
			},
		).toStrictEqual(
			{
				agents: [
					{
						name: "code-reviewer",
						description: "Reviews",
					},
				],
				missing: [],
			},
		);
	});
});

describe("agentMentionOptions", () =>
{
	it("keeps agents whose name holds the query, all for an empty one, at most 10", () =>
	{
		const agents = Array.from(
			{
				length: 12,
			},
			(_, i) => (
			{
				name: `Agent-${i}`,
			}),
		);

		expect(
			{
				match: agentMentionOptions(
					[
						{
							name: "code-reviewer",
							description: "Reviews",
						},
						{
							name: "planner",
						},
					],
					"REV",
				),
				capped: agentMentionOptions(agents, "").length,
			},
		).toStrictEqual(
			{
				match: [
					{
						id: "code-reviewer",
						providerId: "ccp-agents",
						label: "code-reviewer",
						description: "Reviews",
						renderedText: "code-reviewer",
						category: "Agents",
						kind: "agent",
					},
				],
				capped: 10,
			},
		);
	});
});
