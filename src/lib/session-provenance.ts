import {isRecord} from "./narrow";
import {foldJsonl, IncrementalJsonlCache, type JsonlFold} from "./incremental-jsonl";
import {costStateFromRecord, type SessionCostState} from "./session-cost";

/** The session-level fields the detail endpoint reports from a transcript's records. */
export interface SessionProvenance {
	/** The first record's `entrypoint`. */
	entrypoint?: string;
	sessionKind?: string;
	/** Every `teamName` the records carry, in first-seen order. */
	teamNames?: string[];
	forkedFromSessionId?: string;
	/** From the latest valid `cost-state` record. */
	costState?: SessionCostState;
}

interface ProvenanceState {
	entrypoint: string | undefined;
	sessionKind: string | undefined;
	teamNames: Set<string>;
	forkedFromSessionId: string | undefined;
	costState: SessionCostState | undefined;
}

/** Folds the fields as `readSession` reads them: first entrypoint, sessionKind and forkedFrom, every teamName, latest cost-state. */
const PROVENANCE_FOLD: JsonlFold<ProvenanceState> = {
	create: () => ({
		entrypoint: undefined,
		sessionKind: undefined,
		teamNames: new Set(),
		forkedFromSessionId: undefined,
		costState: undefined,
	}),
	add: (state, line) => {
		// Only a line that names one of the fields can set it, so most lines skip JSON.parse altogether.
		const wantsEntrypoint = state.entrypoint === undefined && line.includes('"entrypoint"');
		const wantsSessionKind = state.sessionKind === undefined && line.includes('"sessionKind"');
		const wantsForkedFrom = state.forkedFromSessionId === undefined && line.includes('"forkedFrom"');
		const wantsTeamName = line.includes('"teamName"');
		const wantsCost = line.includes('"cost-state"');
		if (!wantsEntrypoint && !wantsSessionKind && !wantsForkedFrom && !wantsTeamName && !wantsCost) return;
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			return;
		}
		if (!isRecord(record)) return;
		if (wantsEntrypoint && typeof record["entrypoint"] === "string") state.entrypoint = record["entrypoint"];
		if (wantsSessionKind && typeof record["sessionKind"] === "string") state.sessionKind = record["sessionKind"];
		if (wantsTeamName && typeof record["teamName"] === "string") state.teamNames.add(record["teamName"]);
		if (wantsForkedFrom) {
			const forked = record["forkedFrom"];
			if (typeof forked === "string") state.forkedFromSessionId = forked;
			else if (isRecord(forked) && typeof forked["sessionId"] === "string")
				state.forkedFromSessionId = forked["sessionId"];
		}
		if (wantsCost && record["type"] === "cost-state")
			state.costState = costStateFromRecord(record) ?? state.costState;
	},
};

/** Each entry is a handful of strings, so the cache can cover every session a reader is likely to switch between. */
const PROVENANCE_CACHE_ENTRIES = 512;

let cache = new IncrementalJsonlCache<ProvenanceState>(PROVENANCE_CACHE_ENTRIES);

export function resetSessionProvenanceCache(): void {
	cache = new IncrementalJsonlCache(PROVENANCE_CACHE_ENTRIES);
}

/**
 * The provenance fields of the transcript at `filePath`. The first read folds the whole file; later reads fold only
 * what was appended since, so reopening a live 100MB+ session costs its new lines rather than another full parse.
 * A missing file has none.
 */
export async function readSessionProvenance(filePath: string): Promise<SessionProvenance> {
	const current = cache;
	let state: ProvenanceState;
	try {
		state = await current.exclusive(filePath, async () => foldJsonl(filePath, PROVENANCE_FOLD, current));
	} catch {
		return {};
	}
	const provenance: SessionProvenance = {};
	if (state.entrypoint !== undefined) provenance.entrypoint = state.entrypoint;
	if (state.sessionKind !== undefined) provenance.sessionKind = state.sessionKind;
	if (state.teamNames.size > 0) provenance.teamNames = [...state.teamNames];
	if (state.forkedFromSessionId !== undefined) provenance.forkedFromSessionId = state.forkedFromSessionId;
	if (state.costState !== undefined) provenance.costState = state.costState;
	return provenance;
}
