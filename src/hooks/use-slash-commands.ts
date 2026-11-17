import {useQuery} from "@tanstack/react-query";
import {useMemo} from "react";
import {slashCommandsQueryOptions} from "../lib/api/commands";
import {CLI_DEFAULT_MODEL, effortLevelsFor} from "../lib/launch-options";
import
{
	BUILTIN_SLASH_COMMANDS,
	type CliTwinContext,
	cliTwinCommands,
	mergeSlashCommands,
	SESSION_SLASH_COMMANDS,
	type SlashCommand,
} from "../lib/slash-commands";

/** Upstream's `y6s5jEXe/X` header for a command list that failed to load. */
const SLASH_COMMANDS_FAILED_HEADER = "Some commands didn’t load.\nType / again to retry.";

/** Upstream's `w51ki9qEWN` header for a session whose command list can't be known yet (`lt`). */
const SLASH_COMMANDS_NOT_RUNNING_HEADER = "More commands available once the session is running";

export interface ComposerSlashCommands
{
	slashCommands: readonly SlashCommand[] | undefined;
	slashMenuHeader: string | undefined;
	/** The list is still being fetched: upstream's `ft` replaces the whole menu with one skeleton row. */
	slashCommandsLoading: boolean;
	onSlashMenuOpen: (() => void) | undefined;
}

/**
 * The composer's "/" list from `GET /api/commands`. A failed fetch falls back to the
 * built-ins under upstream's error header (`pt`) and refetches when the next "/" opens
 * the menu, as upstream's `retry:false` query does when the menu remounts. A disabled
 * query (no session directory) shows the built-ins under upstream's not-running header.
 * A `session` composer also lists the session-only built-ins (`/rewind`) first, and the local CLI's own rows for
 * the built-ins it intercepts (`twinCtx`, defaulting to the CLI's default model with `/fast` listed).
 */
export function useSlashCommands(
	cwd: string | undefined,
	enabled = true,
	session = false,
	twinCtx?: CliTwinContext,
): ComposerSlashCommands
{
	const query = useQuery(
		{
			...slashCommandsQueryOptions(cwd),
			enabled,
			retry: false,
		},
	);
	const withSession = useSessionCommands(session, twinCtx ?? DEFAULT_TWIN_CONTEXT);
	if (!enabled)
	{
		return {
			slashCommands: withSession(BUILTIN_SLASH_COMMANDS),
			slashMenuHeader: SLASH_COMMANDS_NOT_RUNNING_HEADER,
			slashCommandsLoading: false,
			onSlashMenuOpen: undefined,
		};
	}
	if (!query.isError)
	{
		return {
			slashCommands: query.data === undefined ? undefined : withSession(query.data),
			slashMenuHeader: undefined,
			slashCommandsLoading: query.isLoading,
			onSlashMenuOpen: undefined,
		};
	}
	const {refetch} = query;
	return {
		slashCommands: withSession(query.data ?? BUILTIN_SLASH_COMMANDS),
		// Upstream drops the header while the retry is in flight.
		slashMenuHeader: query.isFetching ? undefined : SLASH_COMMANDS_FAILED_HEADER,
		slashCommandsLoading: false,
		onSlashMenuOpen: () => void refetch(),
	};
}

const DEFAULT_TWIN_CONTEXT: CliTwinContext =
{
	effortLevels: effortLevelsFor(CLI_DEFAULT_MODEL),
	fastListed: true,
};

function isPluginEntry(command: SlashCommand): boolean
{
	return command.source === "plugin-skill" || command.source === "plugin-command";
}

/**
 * Prepends {@link SESSION_SLASH_COMMANDS} for a session and inserts the CLI's own twin rows ({@link cliTwinCommands})
 * before the first plugin entry, upstream's CLI-block position. Memoized per list so the menu sees a stable array.
 */
function useSessionCommands(
	session: boolean,
	twinCtx: CliTwinContext,
): (list: readonly SlashCommand[]) => readonly SlashCommand[]
{
	const levelsKey = twinCtx.effortLevels.join("|");
	const {fastListed} = twinCtx;
	return useMemo(() =>
	{
		if (!session) return (list) => list;
		const ctx: CliTwinContext =
		{
			effortLevels: levelsKey === "" ? [] : levelsKey.split("|"),
			fastListed,
		};
		const cache = new WeakMap<readonly SlashCommand[], readonly SlashCommand[]>();
		return (list) =>
		{
			const cached = cache.get(list);
			if (cached !== undefined) return cached;
			const twins = cliTwinCommands([...SESSION_SLASH_COMMANDS, ...list], ctx);
			const pluginAt = list.findIndex(isPluginEntry);
			const split = pluginAt === -1 ? list.length : pluginAt;
			const merged = mergeSlashCommands([SESSION_SLASH_COMMANDS, list.slice(0, split), twins, list.slice(split)]);
			cache.set(list, merged);
			return merged;
		};
	}, [session, levelsKey, fastListed]);
}
