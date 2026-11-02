import {pageTitle} from "../lib/route-title";
import {useQuery} from "@tanstack/react-query";
import {createFileRoute, Link, useNavigate} from "@tanstack/react-router";
import {HerdrTerminal} from "../components/herdr-terminal";
import {PaneSwitcher, PaneTerminalToolbar} from "../components/herdr-terminal-actions";
import {herdrPanesQueryOptions} from "../lib/api/herdr";
import {herdrTerminalsQueryOptions} from "../lib/api/herdr-terminals";
import {findTerminalPane, paneAfterClose} from "../lib/herdr/terminal-tab-nav";

export const Route = createFileRoute("/terminals/pane/$paneId")(
	{
		component: PaneTerminalPage,
		head: () => (
		{
			meta: [pageTitle("Live terminal")],
		}),
	},
);

/**
 * Any herdr pane's live terminal by pane id: a plain shell, another agent, or
 * a Claude pane ccp has no transcript for. The same standalone surface as a
 * session's `/terminals/$sessionId` pop-out, typing through the control socket
 * while Live terminal input is on. Until herdr's terminal list loads (or while
 * it refetches) the pane is assumed live; once it has loaded without it, the
 * view shows it closed.
 *
 * The header switches between the panes of the pane's tab and, while Live
 * terminal input is on, splits, renames the tab and closes the pane.
 */
function PaneTerminalPage()
{
	const {paneId} = Route.useParams();
	const terminals = useQuery(herdrTerminalsQueryOptions);
	const workspaces = terminals.data?.workspaces;
	const writesEnabled = useQuery(herdrPanesQueryOptions).data?.writesEnabled ?? false;
	const navigate = useNavigate();
	const found = findTerminalPane(workspaces, paneId);
	const pane = found?.pane ?? null;
	const tab = found?.tab ?? null;
	// A pane opened a moment ago is missing from the list until its refetch lands.
	const live = workspaces === undefined || pane !== null || terminals.isFetching;

	return (
		<div className="flex h-[calc(100dvh-1rem)] min-h-96 flex-col gap-3 pb-4">
			<div className="flex min-w-0 items-center gap-3">
				<Link to="/terminals" className="text-sm text-t6 hover:text-primary">
					Terminals
				</Link>
				<span className="text-t6">/</span>
				<h1 className="truncate text-lg font-semibold">{pane?.title ?? "Live terminal"}</h1>
				{pane?.cwd != null && (
					<span data-testid="terminal-cwd" className="truncate text-sm text-t6">
						{pane.cwd}
					</span>
				)}
				<div className="ms-auto flex min-w-0 items-center gap-2">
					{tab !== null && <PaneSwitcher tab={tab} paneId={paneId} />}
					<PaneTerminalToolbar
						tab={tab}
						pane={pane}
						writesEnabled={writesEnabled}
						nextPaneAfterClose={tab === null ? null : paneAfterClose(tab, paneId)}
						onNavigate={(target) =>
						{
							void navigate(
								{
									to: "/terminals/pane/$paneId",
									params:
									{
										paneId: target,
									},
								},
							);
						}}
					/>
				</div>
			</div>
			<section
				data-pane-kind="terminal"
				data-terminal-standalone=""
				aria-label="Terminal"
				className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface-2 shadow-panel-sm"
			>
				{live ? (
					<HerdrTerminal key={paneId} paneId={paneId} variant="pane" interactive={writesEnabled} />
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
						<p className="text-body text-primary">Terminal closed</p>
						<Link to="/terminals" className="text-body text-accent-100 hover:underline">
							Back to Terminals
						</Link>
					</div>
				)}
			</section>
		</div>
	);
}
