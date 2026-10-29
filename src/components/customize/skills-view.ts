import type {SkillSummary} from "../../lib/api/customize";
import type {UserCommandGroupData} from "../../lib/api/plugins";
import {matchesQuery} from "./sections";
import {assertNever} from "../../lib/assert-never";

export interface SkillGroup {
	key: string;
	title: string;
	skills: SkillSummary[];
}

/** Skills from one source ("all" keeps every source) whose text matches `q`. */
export function filterSkills(skills: readonly SkillSummary[], source: string, q: string | undefined): SkillSummary[] {
	return skills.filter(
		(skill) =>
			(source === "all" || skill.source === source) &&
			matchesQuery(q, skill.name, skill.description, skill.sourceLabel),
	);
}

/** "name" sorts A–Z; anything else sorts by SKILL.md mtime, newest first. */
export function sortSkills(skills: readonly SkillSummary[], sort: string): SkillSummary[] {
	const byName = (a: SkillSummary, b: SkillSummary) =>
		a.name.localeCompare(b.name) || a.sourceLabel.localeCompare(b.sourceLabel);
	const compare = sort === "name" ? byName : (a: SkillSummary, b: SkillSummary) => b.mtime - a.mtime || byName(a, b);
	return skills.toSorted(compare);
}

function groupOf(skill: SkillSummary): {key: string; title: string; rank: number} {
	switch (skill.source) {
		case "personal":
			return {key: "personal", title: "Personal", rank: 0};
		case "project":
			// The id is `project:<projectId>:<name>`, so two same-named checkouts stay apart.
			return {
				key: skill.id.slice(0, skill.id.length - skill.name.length - 1),
				title: `Project · ${skill.sourceLabel}`,
				rank: 1,
			};
		case "plugin":
			return {key: "plugin", title: "From plugins", rank: 2};
		default:
			return assertNever(skill.source);
	}
}

/**
 * Sections in upstream order: Personal, one "Project · <name>" per project
 * (A–Z), then "From plugins". Skills keep their incoming order within a group.
 */
export function groupSkills(skills: readonly SkillSummary[]): SkillGroup[] {
	const groups = new Map<string, SkillGroup & {rank: number}>();
	for (const skill of skills) {
		const {key, title, rank} = groupOf(skill);
		let group = groups.get(key);
		if (group === undefined) {
			group = {key, title, rank, skills: []};
			groups.set(key, group);
		}
		group.skills.push(skill);
	}
	return [...groups.values()]
		.toSorted((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
		.map(({key, title, skills: members}) => ({key, title, skills: members}));
}

/** The slash command that runs the skill; plugin skills are namespaced by plugin. */
export function skillInvocation(skill: SkillSummary): string {
	return skill.source === "plugin" ? `/${skill.sourceLabel}:${skill.name}` : `/${skill.name}`;
}

export interface CommandRow {
	key: string;
	source: string;
	filename: string;
	invocation: string;
	sourceName: string;
	description: string;
}

/**
 * Legacy `.claude/commands/*.md` files, listed among skills as claude.ai/code
 * does ("Custom command"). They show under the All and Custom commands
 * filters, A–Z by invocation.
 */
export function commandRows(
	groups: readonly UserCommandGroupData[],
	source: string,
	q: string | undefined,
): CommandRow[] {
	if (source !== "all" && source !== "command") return [];
	return groups
		.flatMap((group) =>
			group.commands.map((command) => ({
				key: `${group.source}:${command.filename}`,
				source: group.source,
				filename: command.filename,
				invocation: `/${command.filename.replace(/\.md$/, "")}`,
				sourceName: group.sourceName,
				description: command.description,
			})),
		)
		.filter((row) => matchesQuery(q, row.invocation, row.description, row.sourceName))
		.toSorted((a, b) => a.invocation.localeCompare(b.invocation) || a.key.localeCompare(b.key));
}

const COMMAND_ID_PREFIX = "command:";

/**
 * The Settings dialog's detail id for a custom command (`#customize/skills/yours/id/<id>`).
 * Skill ids start with their source (`personal:`, `project:`, `plugin:`), so the prefix can't collide.
 */
export function commandDetailId(source: string, filename: string): string {
	return `${COMMAND_ID_PREFIX}${source}:${filename}`;
}

/** The command a `commandDetailId` names, or null for a skill id. */
export function parseCommandDetailId(id: string): {source: string; filename: string} | null {
	if (!id.startsWith(COMMAND_ID_PREFIX)) return null;
	const rest = id.slice(COMMAND_ID_PREFIX.length);
	const colon = rest.lastIndexOf(":");
	if (colon <= 0 || colon === rest.length - 1) return null;
	return {source: rest.slice(0, colon), filename: rest.slice(colon + 1)};
}
