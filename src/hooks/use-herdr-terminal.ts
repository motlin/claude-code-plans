import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {useCallback} from "react";
import {applicationSettingsQueryOptions} from "../lib/api/application-settings";
import {createHerdrTerminal, herdrTerminalsQueryOptions} from "../lib/api/herdr-terminals";

/**
 * Start a login shell in a new herdr tab at `cwd` (home when null), then
 * navigate to its `/terminals/pane/$paneId` view. Rejects when herdr refuses.
 */
export function useStartHerdrTerminal(): (cwd: string | null) => Promise<void> {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return useCallback(
		async (cwd: string | null) => {
			const paneId = await createHerdrTerminal(cwd);
			void queryClient.invalidateQueries({queryKey: herdrTerminalsQueryOptions.queryKey});
			await navigate({to: "/terminals/pane/$paneId", params: {paneId}});
		},
		[navigate, queryClient],
	);
}

/** New herdr panes are typed into, so they are offered only while Live terminal input is on. */
export function useTerminalWritesEnabled(): boolean {
	return (
		useQuery({...applicationSettingsQueryOptions, select: (settings) => settings.terminalWritesEnabled}).data ??
		false
	);
}
