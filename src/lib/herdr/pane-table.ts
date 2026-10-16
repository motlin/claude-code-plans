import type {z} from "zod";
import {hmrPersist} from "../hmr-persist";
import {HerdrPaneInfoSchema, type HerdrSessionSnapshotResultSchema} from "./schema";
import {compareHerdrAttention} from "./viewed-state";

type HerdrSnapshot = z.infer<typeof HerdrSessionSnapshotResultSchema>["snapshot"];
type HerdrWirePane = z.infer<typeof HerdrPaneInfoSchema>;

/** The slice of herdr's session snapshot that ccp's read models consume. */
export type HerdrPaneState = Pick<HerdrSnapshot, "workspaces" | "panes">;

/**
 * Process-wide pane and workspace state kept current by herdr's push events.
 *
 * The event bridge seeds it with one `session.snapshot` per (re)connect and
 * applies each pushed pane event it accepts, so request handlers read herdr
 * state from memory instead of opening a socket per request. While the bridge
 * is disconnected the table is not current and readers fall back to herdr.
 */
export interface HerdrPaneTable {
	seed(state: HerdrPaneState): void;
	invalidate(): void;
	/** The current state, never mutated afterwards, or `null` when the table is not tracking herdr right now. */
	current(): HerdrPaneState | null;
	apply(event: string, data: Record<string, unknown>): void;
}

const STATUS_PATCH_FIELDS = ["agent", "display_agent", "title", "state_labels"] as const;

function parsePane(value: unknown): HerdrWirePane | null {
	const parsed = HerdrPaneInfoSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

function stringField(data: Record<string, unknown>, key: string): string | null {
	const value = data[key];
	return typeof value === "string" ? value : null;
}

function cloneState(state: HerdrPaneState): HerdrPaneState {
	return structuredClone({workspaces: state.workspaces, panes: state.panes});
}

export function createHerdrPaneTable(): HerdrPaneTable {
	let state: HerdrPaneState | null = null;

	// herdr's workspace status is its most attention-worthy pane status, so
	// a pane push implies a workspace change herdr announces no event for.
	const rederiveWorkspaceStatus = (current: HerdrPaneState, workspaceId: string): void => {
		const workspace = current.workspaces.find((candidate) => candidate.workspace_id === workspaceId);
		if (!workspace) return;
		const statuses = current.panes
			.filter((pane) => pane.workspace_id === workspaceId)
			.map((pane) => ({agentStatus: pane.agent_status}))
			.toSorted(compareHerdrAttention);
		const [top] = statuses;
		if (top) workspace.agent_status = top.agentStatus;
	};

	const removePane = (current: HerdrPaneState, paneId: string): string | null => {
		const index = current.panes.findIndex((pane) => pane.pane_id === paneId);
		if (index === -1) return null;
		const [removed] = current.panes.splice(index, 1);
		return removed?.workspace_id ?? null;
	};

	const applyToState = (current: HerdrPaneState, event: string, data: Record<string, unknown>): string[] => {
		switch (event) {
			case "pane_created": {
				const pane = parsePane(data["pane"]);
				if (!pane) return [];
				removePane(current, pane.pane_id);
				current.panes.push(pane);
				return [pane.workspace_id];
			}
			case "pane_updated": {
				const pane = parsePane(data["pane"]);
				if (!pane) return [];
				// Updates never insert: herdr replays updates for zombie panes the snapshot omits.
				const index = current.panes.findIndex((candidate) => candidate.pane_id === pane.pane_id);
				const known = current.panes[index];
				if (!known || pane.revision < known.revision) return [];
				current.panes[index] = pane;
				return [known.workspace_id, pane.workspace_id];
			}
			case "pane_moved": {
				const pane = parsePane(data["pane"]);
				if (!pane) return [];
				const previousPaneId = stringField(data, "previous_pane_id");
				const previousWorkspaceId = previousPaneId === null ? null : removePane(current, previousPaneId);
				removePane(current, pane.pane_id);
				current.panes.push(pane);
				return previousWorkspaceId === null ? [pane.workspace_id] : [previousWorkspaceId, pane.workspace_id];
			}
			case "pane_closed": {
				const paneId = stringField(data, "pane_id");
				const workspaceId = paneId === null ? null : removePane(current, paneId);
				return workspaceId === null ? [] : [workspaceId];
			}
			case "pane_agent_status_changed":
			case "pane_agent_detected": {
				const paneId = stringField(data, "pane_id");
				const pane = current.panes.find((candidate) => candidate.pane_id === paneId);
				if (!pane) return [];
				if (event === "pane_agent_status_changed") {
					const status = stringField(data, "agent_status");
					if (status === null) return [];
					pane.agent_status = status;
					for (const field of STATUS_PATCH_FIELDS) {
						if (field in data) Object.assign(pane, {[field]: data[field]});
					}
				} else if ("agent" in data) {
					pane.agent = stringField(data, "agent");
				}
				return [pane.workspace_id];
			}
			default:
				return [];
		}
	};

	return {
		seed(next) {
			state = cloneState(next);
		},
		invalidate() {
			state = null;
		},
		current() {
			return state;
		},
		apply(event, data) {
			if (state === null) return;
			// Copy on write so a state handed out by current() never changes under its reader.
			const next = cloneState(state);
			const touchedWorkspaceIds = new Set(applyToState(next, event, data));
			if (touchedWorkspaceIds.size === 0) return;
			for (const workspaceId of touchedWorkspaceIds) rederiveWorkspaceStatus(next, workspaceId);
			state = next;
		},
	};
}

/** The table the event bridge maintains and every herdr read model consults. */
export const herdrPaneTable: HerdrPaneTable = hmrPersist("herdrPaneTable", createHerdrPaneTable);
