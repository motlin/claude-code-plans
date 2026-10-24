import {useQuery} from "@tanstack/react-query";
import {slashCommandsQueryOptions} from "../lib/api/commands";
import {BUILTIN_SLASH_COMMANDS, type SlashCommand} from "../lib/slash-commands";

/** Upstream's `y6s5jEXe/X` header for a command list that failed to load. */
const SLASH_COMMANDS_FAILED_HEADER = "Some commands didn’t load. Type / again to retry.";

export interface ComposerSlashCommands {
	slashCommands: readonly SlashCommand[] | undefined;
	slashMenuHeader: string | undefined;
	onSlashMenuOpen: (() => void) | undefined;
}

/**
 * The composer's "/" list from `GET /api/commands`. A failed fetch falls back to the
 * built-ins under upstream's error header (`pt`) and refetches when the next "/" opens
 * the menu, as upstream's `retry:false` query does when the menu remounts.
 */
export function useSlashCommands(cwd: string | undefined, enabled = true): ComposerSlashCommands {
	const query = useQuery({...slashCommandsQueryOptions(cwd), enabled, retry: false});
	if (!query.isError) return {slashCommands: query.data, slashMenuHeader: undefined, onSlashMenuOpen: undefined};
	const {refetch} = query;
	return {
		slashCommands: query.data ?? BUILTIN_SLASH_COMMANDS,
		// Upstream drops the header while the retry is in flight.
		slashMenuHeader: query.isFetching ? undefined : SLASH_COMMANDS_FAILED_HEADER,
		onSlashMenuOpen: () => void refetch(),
	};
}
