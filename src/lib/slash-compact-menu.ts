import {type SlashCommand, slashCommandLabel, type SlashMenuItem} from "./slash-commands";

/*
 * Upstream's grouped empty-query "/" menu with host rows, gated by GrowthBook `__gb__3159821575` (`jCe`, read by
 * `Bi(jCe)` in cc43287c9 and passed as `compactSlashMenuHost`). The gate was still off for the live account on
 * 2026-11-05; locally it ships on (upstream-sync M6, 11-04 Q2 answer c). Switching it off restores the flat menu,
 * the 384px cap, the content width, the mid-message name rule and the unranked, unrecorded picks.
 */
export const COMPACT_SLASH_MENU_HOST = true;

/** Upstream `Or`: at most this many skills show inline before the All skills submenu. */
const TOP_SKILLS = 3;

export interface CompactSlashMenuLabels
{
	skills: string;
	allSkills: string;
	manageSkills: string;
	compact: string;
	allCommands: string;
}

/*
 * "Skills" (EJSVsOA19u) and "Compact session" (JEeNJA) are upstream's English. "All skills" (1yb9j65), "Manage
 * skills" (r704gf) and "All commands" (19y5o7n) are secret messages withheld until rollout; these are their `labels`
 * keys. Re-read them on rollout.
 */
export const COMPACT_SLASH_MENU_LABELS: CompactSlashMenuLabels =
{
	skills: "Skills",
	allSkills: "All skills",
	manageSkills: "Manage skills",
	compact: "Compact session",
	allCommands: "All commands",
};

/** The query-matched-nothing header (secret `ymz73o`, withheld upstream): provisional, re-read on rollout. */
export const NO_MATCH_LABEL = "No matching commands";

/** The Remote Control toggle row's label (secret `hh528h`, withheld upstream): provisional, re-read on rollout. */
const REMOTE_CONTROL_ROW_LABEL = "Remote Control";

/** The fixed Environment row's subtitle (secret `9359ff`, withheld upstream): provisional, re-read on rollout. */
const FIXED_ENVIRONMENT_SUBTITLE = "Set when the session started";

export interface CompactSlashMenuInput
{
	commands: readonly SlashCommand[];
	/** Section headers already in the list (upstream `notices`), which lead the menu with no separator. */
	notices: readonly string[];
	/** Model, Environment and Remote Control (upstream `compactHostRows`). */
	hostRows: readonly SlashMenuItem[];
	inSession: boolean;
	usageScore: (command: SlashCommand) => number;
	/** Upstream `ca`: not one of Claude Code's bundled skills. */
	isOwnSkill: (command: SlashCommand) => boolean;
	labels: CompactSlashMenuLabels;
}

const SKILL_SOURCES: ReadonlySet<SlashCommand["source"]> = new Set(["personal-skill", "project-skill", "plugin-skill"]);

/* Upstream `kr`: one row per name, routing, source and description. */
function dedupeKey(command: SlashCommand): string
{
	const routing = command.shadowsHost === true ? "cli" : "";
	return `skill:${command.name.toLowerCase()}:${routing}:${command.pluginName ?? ""}:${command.description}`;
}

function commandRow(command: SlashCommand): SlashMenuItem
{
	return {
		type: "command",
		command,
	};
}

/**
 * Upstream `jr`: notices, then Skills (the top 3 by usage, own skills first, plus an All skills submenu sorted by
 * label), the host rows with Compact session in a session, and an All commands submenu, each group dropped when empty
 * and the groups joined by `compact-<n>` separators.
 */
export function buildCompactSlashMenu({
	commands,
	notices,
	hostRows,
	inSession,
	usageScore,
	isOwnSkill,
	labels,
}: CompactSlashMenuInput): SlashMenuItem[]
{
	const seen = new Set<string>();
	const rows = commands.filter((command) =>
	{
		const key = dedupeKey(command);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	const skills = rows.filter((command) => SKILL_SOURCES.has(command.source));
	const others = rows.filter((command) => !SKILL_SOURCES.has(command.source));
	/* Upstream `p`: the built-in row of that name, relabeled. */
	const relabeled = (name: string, label: string): SlashMenuItem[] =>
	{
		const command = others.find((row) => row.source === "builtin" && row.name.toLowerCase() === name);
		return command === undefined
			? []
			: [
					{
						type: "command",
						command,
						label,
					},
				];
	};
	const order = new Map(skills.map((command, index) => [command, index]));
	const top = skills.toSorted(
		(a, b) =>
			usageScore(b) - usageScore(a) ||
			Number(isOwnSkill(b)) - Number(isOwnSkill(a)) ||
			(order.get(a) ?? 0) - (order.get(b) ?? 0),
	);
	const byLabel = skills.toSorted((a, b) => slashCommandLabel(a).localeCompare(slashCommandLabel(b)));
	const skillGroup: SlashMenuItem[] =
		skills.length === 0
			? relabeled("skills", labels.manageSkills)
			: [
					{
						type: "section-header",
						label: labels.skills,
					},
					...(byLabel.length <= TOP_SKILLS
						? top.map(commandRow)
						: [
								...top.slice(0, TOP_SKILLS).map(commandRow),
								{
									type: "submenu" as const,
									label: labels.allSkills,
									items: byLabel.map(commandRow),
								},
							]),
				];
	const groups: SlashMenuItem[][] = [
		skillGroup,
		[...hostRows, ...(inSession ? relabeled("compact", labels.compact) : [])],
		others.length === 0
			? []
			: [
					{
						type: "submenu",
						label: labels.allCommands,
						items: others.map(commandRow),
					},
				],
	];
	return [
		...notices.map((label): SlashMenuItem => (
		{
			type: "section-header",
			label,
		})),
		...groups
			.filter((group) => group.length > 0)
			.flatMap((group, index) =>
				index === 0
					? group
					: [
							{
								type: "separator" as const,
								label: `compact-${index}`,
							},
							...group,
						],
			),
	];
}

/** Upstream `ICe`'s Remote Control model for the toggle row; `toggle` is null while it can't change. */
export interface SlashRemoteControl
{
	on: boolean;
	toggle: (() => void) | null;
	reason?: string | undefined;
}

/** The home draft's Environment row: the chosen place, and how to open its picker when there is a choice. */
export interface SlashEnvironment
{
	value: string;
	open: (() => void) | null;
}

/** Upstream `Nb`: a highlighted submenu row opens its nested list after this long. */
export const SUBMENU_OPEN_DELAY_MS = 150;

/** The value of a session's fixed Environment row: every local session runs on this machine (upstream `ACe` local). */
const LOCAL_ENVIRONMENT = "Local";

/**
 * Upstream's `compactHostRows`: Model (a flyout onto the chin's model menu, when there is a chin), Environment (fixed
 * in a session; on the home draft a flyout when there is a choice) and the Remote Control toggle (only while the
 * session can change it).
 */
export function compactSlashHostRows({
	model,
	inSession,
	environment,
	remoteControl,
}: {
	model: string | null;
	inSession: boolean;
	environment: SlashEnvironment | undefined;
	remoteControl: SlashRemoteControl | null;
}): SlashMenuItem[]
{
	const value = inSession ? LOCAL_ENVIRONMENT : (environment?.value ?? LOCAL_ENVIRONMENT);
	const environmentRow: SlashMenuItem =
		!inSession && environment?.open != null
			?
				{
					type: "submenu",
					label: "Environment",
					value,
					flyout: "environment",
					items: [],
				}
			:
				{
					type: "host",
					label: "Environment",
					value,
					disabled: true,
					undimmed: true,
					...(inSession
						?
							{
								subtitle: FIXED_ENVIRONMENT_SUBTITLE,
							}
						: {}),
				};
	return [
		...(model === null
			? []
			: [
					{
						type: "submenu" as const,
						label: "Model",
						value: model,
						flyout: "model" as const,
						items: [],
					},
				]),
		environmentRow,
		...(remoteControl === null
			? []
			: [
					{
						type: "toggle" as const,
						label: REMOTE_CONTROL_ROW_LABEL,
						checked: remoteControl.on,
						disabled: remoteControl.toggle === null,
						...(remoteControl.reason === undefined
							? {}
							:
								{
									subtitle: remoteControl.reason,
								}),
					},
				]),
	];
}
