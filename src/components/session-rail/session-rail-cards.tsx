import {Link} from "@tanstack/react-router";
import {Cpu, GitBranch, Laptop, SquareTerminal} from "lucide-react";

import type {HerdrPaneIndexData} from "../../lib/api/herdr";
import {openSessionInFinder} from "../../lib/api/sessions";
import {writeClipboardText} from "../../lib/clipboard";
import {useToast} from "../toast-context";
import {RAIL_ROW_ACTION_CLASS, RailRow, RailRowContent, SessionRail, type RailCard} from "./session-rail";

/** What the session page knows that the rail's cards show. */
export interface SessionRailInputs {
	sessionId: string;
	homeRoot: string;
	cwd: string | null;
	gitBranch: string | null;
	/** The composer chin's model label. */
	model: string | null;
	herdrPane: HerdrPaneIndexData["panes"][number] | null;
}

function homeRelative(path: string, homeRoot: string): string {
	return path === homeRoot || path.startsWith(`${homeRoot}/`) ? `~${path.slice(homeRoot.length)}` : path;
}

/** Upstream's Environment card: where the session runs. Locally, its folder, branch, model and herdr pane. */
function EnvironmentBody({inputs}: {inputs: SessionRailInputs}) {
	const toast = useToast();
	const {cwd, gitBranch, model, herdrPane} = inputs;
	return (
		<div data-testid="rail-rows" className="flex flex-col">
			{cwd !== null && (
				<button
					type="button"
					title={cwd}
					aria-label={`Open ${homeRelative(cwd, inputs.homeRoot)} in Finder`}
					className={RAIL_ROW_ACTION_CLASS}
					onClick={() => {
						openSessionInFinder(inputs.sessionId).catch(() => {
							toast({kind: "error", message: "Couldn’t open the folder in Finder."});
						});
					}}
				>
					<RailRowContent icon={<Laptop aria-hidden />} label={homeRelative(cwd, inputs.homeRoot)} />
				</button>
			)}
			{gitBranch !== null && (
				<button
					type="button"
					title={`Copy ${gitBranch}`}
					className={RAIL_ROW_ACTION_CLASS}
					onClick={() => {
						void writeClipboardText(gitBranch).then((copied) => {
							toast(
								copied
									? {kind: "success", message: "Branch name copied to clipboard."}
									: {kind: "error", message: "Couldn’t copy the branch name. Try again."},
							);
						});
					}}
				>
					<RailRowContent icon={<GitBranch aria-hidden />} label={gitBranch} />
				</button>
			)}
			{model !== null && <RailRow icon={<Cpu aria-hidden />} label={model} />}
			{herdrPane === null ? (
				<RailRow icon={<SquareTerminal aria-hidden />} label="herdr" hint="Not connected" />
			) : (
				<Link
					to="/herdr/terminal/$sessionId"
					params={{sessionId: inputs.sessionId}}
					className={RAIL_ROW_ACTION_CLASS}
				>
					<RailRowContent icon={<SquareTerminal aria-hidden />} label="herdr" hint={herdrPane.agentStatus} />
				</Link>
			)}
		</div>
	);
}

/** Builds the cards with content, in upstream's default order. */
function railCards(inputs: SessionRailInputs): RailCard[] {
	return [{id: "environment", body: <EnvironmentBody inputs={inputs} />}];
}

/** The rail's lazy chunk: the cards the session has content for. */
export function SessionRailCards({inputs}: {inputs: SessionRailInputs}) {
	return <SessionRail sessionId={inputs.sessionId} cards={railCards(inputs)} />;
}
