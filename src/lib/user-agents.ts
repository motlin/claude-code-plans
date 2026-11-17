/**
 * The user's own subagents (`~/.claude/agents/*.md`), which the home draft's `@` Agents provider offers and
 * `claude --agent <name>` launches with: upstream lists the desktop bridge's `source === "user"` agents.
 */
import {readdir, readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

import type {UserAgent} from "./api/user-agents";
import {parseFrontmatter} from "./plugins";

function unquote(value: string): string
{
	return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/** Each agent file's frontmatter `name` and optional `description`, by name; files without a name are skipped. */
export async function readUserAgents(agentsDir: string = join(homedir(), ".claude", "agents")): Promise<UserAgent[]>
{
	let entries: string[];
	try
	{
		entries = await readdir(agentsDir);
	}
	catch
	{
		return [];
	}
	const agents: UserAgent[] = [];
	for (const file of entries.filter((entry) => entry.endsWith(".md")).toSorted())
	{
		let content: string;
		try
		{
			content = await readFile(join(agentsDir, file), "utf-8");
		}
		catch
		{
			continue;
		}
		const {frontmatter} = parseFrontmatter(content);
		const name = unquote(frontmatter["name"] ?? "");
		if (name === "") continue;
		const description = unquote(frontmatter["description"] ?? "");
		agents.push(
			{
				name,
				...(description === ""
					? {}
					:
						{
							description,
						}),
			},
		);
	}
	return agents;
}
