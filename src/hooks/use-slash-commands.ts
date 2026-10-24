import {useQuery} from "@tanstack/react-query";
import {slashCommandsQueryOptions} from "../lib/api/commands";
import {BUILTIN_SLASH_COMMANDS, type SlashCommand} from "../lib/slash-commands";

/** Upstream's `y6s5jEXe/X` header for a command list that failed to load. */
const SLASH_COMMANDS_FAILED_HEADER = "Some commands didn’t load. Type / again to retry.";

/** Upstream's `w51ki9qEWN` header for a session whose command list can't be known yet (`lt`). */
const SLASH_COMMANDS_NOT_RUNNING_HEADER = "More commands available once the session is running";

export interface ComposerSlashCommands {
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
 */
export function useSlashCommands(cwd: string | undefined, enabled = true): ComposerSlashCommands {
	const query = useQuery({...slashCommandsQueryOptions(cwd), enabled, retry: false});
	if (!enabled) {
		return {
			slashCommands: BUILTIN_SLASH_COMMANDS,
			slashMenuHeader: SLASH_COMMANDS_NOT_RUNNING_HEADER,
			slashCommandsLoading: false,
			onSlashMenuOpen: undefined,
		};
	}
	if (!query.isError) {
		return {
			slashCommands: query.data,
			slashMenuHeader: undefined,
			slashCommandsLoading: query.isLoading,
			onSlashMenuOpen: undefined,
		};
	}
	const {refetch} = query;
	return {
		slashCommands: query.data ?? BUILTIN_SLASH_COMMANDS,
		// Upstream drops the header while the retry is in flight.
		slashMenuHeader: query.isFetching ? undefined : SLASH_COMMANDS_FAILED_HEADER,
		slashCommandsLoading: false,
		onSlashMenuOpen: () => void refetch(),
	};
}
