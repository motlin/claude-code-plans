import {Link} from "@tanstack/react-router";
import type {HerdrTerminalPaneData, HerdrTerminalWorkspaceData} from "../lib/api/herdr-terminals";
import {splitTerminalTitleGlyph} from "../lib/herdr/terminal-title";
import {tabName} from "../lib/herdr/terminal-tab-nav";
import {PaneActionsMenu, TabActionsMenu} from "./herdr-terminal-actions";
import {HerdrStatusIndicator} from "./herdr-status-indicator";

/**
 * Fixed tracks so the kind badge, cwd and status line up down the list, as the
 * tracked-session rows above it do; below 640px the row wraps with the title
 * on its own line.
 */
const PANE_ROW =
	"grid min-w-0 flex-1 grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,14rem)_5rem] items-center gap-2 rounded-md border border-border p-3 no-underline transition-colors hover:bg-surface-0 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus max-sm:flex max-sm:flex-wrap";

const KIND_BADGE = "rounded bg-surface-0/60 px-1.5 py-0.5 text-center text-[10px] text-t6";

const PROCESS_DOT: Readonly<Record<HerdrTerminalPaneData["process"], string>> = {
	idle: "bg-green-500",
	running: "bg-yellow-500",
	exited: "bg-gray-500",
	unknown: "bg-gray-500",
};

/** A shell's state in the agent status indicator's shape: is a command holding the foreground? */
function ProcessIndicator({process}: {process: HerdrTerminalPaneData["process"]}) {
	return (
		<span
			className="grid grid-cols-[0.625rem_minmax(0,1fr)] items-center gap-1.5 text-xs text-t6"
			aria-label={`Shell: ${process}`}
		>
			<span className={`h-2.5 w-2.5 rounded-full ${PROCESS_DOT[process]}`} aria-hidden="true" />
			<span className="truncate">{process}</span>
		</span>
	);
}

function PaneRow({pane}: {pane: HerdrTerminalPaneData}) {
	const {glyph, title} = splitTerminalTitleGlyph(pane.title);
	const label = `Open live terminal for ${pane.title}`;
	const cells = (
		<>
			<span className={KIND_BADGE}>{pane.agent ?? "shell"}</span>
			<span className="truncate text-sm font-medium text-primary max-sm:order-first max-sm:basis-full">
				{glyph === null ? null : (
					<span aria-hidden="true" className="mr-1 text-t6">
						{glyph}
					</span>
				)}
				{title}
				{pane.agent === null && pane.command !== null && (
					<span className="ml-2 font-mono text-xs font-normal text-t6">{pane.command}</span>
				)}
			</span>
			<span className="truncate text-xs text-t6">{pane.cwd}</span>
			{pane.agent === null ? (
				<ProcessIndicator process={pane.process} />
			) : (
				<HerdrStatusIndicator status={pane.agentStatus} />
			)}
		</>
	);

	// A Claude pane opens its session's terminal, which links back to the transcript; any other pane opens by id.
	return pane.claudeSessionId === null ? (
		<Link
			to="/terminals/pane/$paneId"
			params={{paneId: pane.paneId}}
			aria-label={label}
			title={label}
			className={PANE_ROW}
		>
			{cells}
		</Link>
	) : (
		<Link
			to="/terminals/$sessionId"
			params={{sessionId: pane.claudeSessionId}}
			aria-label={label}
			title={label}
			className={PANE_ROW}
		>
			{cells}
		</Link>
	);
}

/**
 * Every herdr terminal by workspace and tab, Claude, other agents and plain
 * shells alike, each row opening the pane's live terminal. While Live
 * terminal input is on (`manageable`), each tab and pane gets a trailing
 * actions menu: split, close and rename.
 */
export function HerdrTerminalList({
	workspaces,
	manageable = false,
}: {
	workspaces: readonly HerdrTerminalWorkspaceData[];
	manageable?: boolean;
}) {
	return (
		<section aria-labelledby="all-herdr-terminals" className="mt-8">
			<h2 id="all-herdr-terminals" className="border-b border-border pb-1 text-sm font-semibold">
				All herdr terminals
			</h2>
			{workspaces.length === 0 ? (
				<p className="mt-2 text-sm text-t6">No herdr terminals are open.</p>
			) : (
				workspaces.map((workspace) => (
					<div key={workspace.workspaceId} className="mt-4">
						<h3 className="text-xs font-medium text-primary">
							<span className="mr-1.5 tabular-nums font-normal text-t6">{workspace.number}</span>
							{workspace.label}
						</h3>
						{workspace.tabs.map((tab) => (
							<div key={tab.tabId} className="mt-2">
								<div className="mb-1 flex items-center gap-1">
									<p aria-hidden="true" className="text-[11px] text-t6">
										Tab {tab.number} · {tab.label}
									</p>
									{manageable && <TabActionsMenu tab={tab} />}
								</div>
								<ul aria-label={tabName(tab)} className="space-y-1">
									{tab.panes.map((pane) => (
										<li key={pane.paneId} className="flex items-center gap-1">
											<PaneRow pane={pane} />
											{manageable && <PaneActionsMenu pane={pane} />}
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				))
			)}
		</section>
	);
}
