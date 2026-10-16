import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import type * as schema from "./db/schema";
import {getCurrentSessionMessageIndex, getSessionViewedState, type DurableSessionViewedState} from "./db/viewed-state";
import {addViewedStateToHerdrPanes} from "./herdr/pane-viewed-state";
import type {HerdrPaneLink, HerdrTerminalPlacement} from "./herdr/panes";
import type {TerminalPlacement} from "./terminal-placements";
import type {TmuxTerminalPlacement} from "./tmux-windows";

type IndexDb = BetterSQLite3Database<typeof schema>;

export type ViewedTmuxTerminalPlacement = TmuxTerminalPlacement & {viewedState: DurableSessionViewedState};
export type ViewedHerdrTerminalPlacement = Omit<HerdrTerminalPlacement, "herdrPane"> & {
	herdrPane: HerdrPaneLink & {viewedState: DurableSessionViewedState};
};

function herdrPlacementKey(sessionId: string, terminalId: string): string {
	return `${sessionId}\0${terminalId}`;
}

/**
 * Add each placement's unread state for the Terminals view. herdr panes also
 * carry herdr's own viewed bit; tmux sessions have only the transcript's, which
 * the Stop hook raises for every host when a turn finishes unseen.
 */
export function addViewedStateToTerminalPlacements(
	db: IndexDb,
	placements: readonly TerminalPlacement[],
): Array<ViewedTmuxTerminalPlacement | ViewedHerdrTerminalPlacement> {
	const tmuxPlacements = placements
		.filter((placement) => placement.provider === "tmux")
		.map((placement) => ({
			...placement,
			viewedState: getSessionViewedState(
				db,
				placement.sessionId,
				getCurrentSessionMessageIndex(db, placement.sessionId),
			),
		}));
	const herdrPlacementsByKey = new Map(
		placements
			.filter((placement) => placement.provider === "herdr")
			.map((placement) => [herdrPlacementKey(placement.sessionId, placement.herdrPane.terminalId), placement]),
	);
	const herdrPanes = addViewedStateToHerdrPanes(
		db,
		[...herdrPlacementsByKey.values()].map((placement) => placement.herdrPane),
	);
	const herdrPlacements = herdrPanes.map((pane) => {
		const placement = herdrPlacementsByKey.get(herdrPlacementKey(pane.sessionId, pane.terminalId));
		if (!placement) throw new Error("Herdr placement disappeared during enrichment");
		return {...placement, herdrPane: pane};
	});
	return [...tmuxPlacements, ...herdrPlacements];
}
