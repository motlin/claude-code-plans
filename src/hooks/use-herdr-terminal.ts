import {useQuery, useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {useCallback, useMemo, useState} from "react";
import {applicationSettingsQueryOptions} from "../lib/api/application-settings";
import
{
	createHerdrTerminal,
	herdrTerminalsQueryOptions,
	runHerdrTerminalAction,
	type HerdrTerminalActionRequest,
} from "../lib/api/herdr-terminals";

/**
 * Start a login shell in a new herdr tab at `cwd` (home when null), then
 * navigate to its `/terminals/pane/$paneId` view. Rejects when herdr refuses.
 */
export function useStartHerdrTerminal(): (cwd: string | null) => Promise<void>
{
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return useCallback(
		async (cwd: string | null) =>
		{
			const paneId = await createHerdrTerminal(cwd);
			void queryClient.invalidateQueries(
				{
					queryKey: herdrTerminalsQueryOptions.queryKey,
				},
			);
			await navigate(
				{
					to: "/terminals/pane/$paneId",
					params:
					{
						paneId,
					},
				},
			);
		},
		[navigate, queryClient],
	);
}

/** New herdr panes are typed into, so they are offered only while Live terminal input is on. */
export function useTerminalWritesEnabled(): boolean
{
	return (
		useQuery(
			{
				...applicationSettingsQueryOptions,
				select: (settings) => settings.terminalWritesEnabled,
			},
		).data ?? false
	);
}

export interface HerdrTerminalActions
{
	/** Split `paneId` and open the new pane's live terminal. */
	split: (paneId: string, direction: "right" | "down") => Promise<void>;
	/** Close `paneId`, then open `nextPaneId` (the Terminals list when null). Omit `nextPaneId` to stay put. */
	closePane: (paneId: string, nextPaneId?: string | null) => Promise<void>;
	closeTab: (tabId: string) => Promise<void>;
	renameTab: (tabId: string, label: string) => Promise<void>;
	/** herdr's reason the last action failed, or "". */
	error: string;
}

/**
 * Split, close and rename herdr panes and tabs, refreshing the terminal list
 * after each. A failure is kept in `error` rather than thrown.
 */
export function useHerdrTerminalActions(): HerdrTerminalActions
{
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [error, setError] = useState("");

	const run = useCallback(
		async (action: HerdrTerminalActionRequest, then?: (created: {paneId?: string | undefined}) => Promise<void>) =>
		{
			setError("");
			try
			{
				const created = await runHerdrTerminalAction(action);
				void queryClient.invalidateQueries(
					{
						queryKey: herdrTerminalsQueryOptions.queryKey,
					},
				);
				await then?.(created);
			}
			catch (cause)
			{
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		},
		[queryClient],
	);

	const openPane = useCallback(
		async (paneId: string | null) =>
			paneId === null
				? navigate(
						{
							to: "/terminals",
						},
					)
				: navigate(
						{
							to: "/terminals/pane/$paneId",
							params:
							{
								paneId,
							},
						},
					),
		[navigate],
	);

	return useMemo(
		() => (
		{
			split: async (paneId, direction) =>
				run(
					{
						action: "split-pane",
						paneId,
						direction,
					},
					async (created) =>
					{
						if (created.paneId !== undefined) await openPane(created.paneId);
					},
				),
			closePane: async (paneId, nextPaneId) =>
				run(
					{
						action: "close-pane",
						paneId,
					},
					async () =>
					{
						if (nextPaneId !== undefined) await openPane(nextPaneId);
					},
				),
			closeTab: async (tabId) =>
				run(
					{
						action: "close-tab",
						tabId,
					},
				),
			renameTab: async (tabId, label) =>
				run(
					{
						action: "rename-tab",
						tabId,
						label,
					},
				),
			error,
		}),
		[run, openPane, error],
	);
}
