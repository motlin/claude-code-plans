import {useState} from "react";
import {fetchTurnUndoPreview, postTurnUndo, type TurnUndoFile} from "../lib/api/turn-undo";

export function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

export function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Why the turn cannot be undone, or null when every file still holds the turn's result. */
function refusal(files: readonly TurnUndoFile[]): string | null {
	if (files.length === 0) return "Can't undo: this turn left no file changes.";
	const conflicts = files.filter((file) => file.state === "conflict").map((f) => basename(f.path));
	if (conflicts.length > 0) {
		const verb = conflicts.length === 1 ? "changed" : "have changed";
		return `Can't undo: ${conflicts.join(", ")} ${verb} since this turn.`;
	}
	const unknown = files.filter((file) => file.state === "unknown").map((f) => basename(f.path));
	if (unknown.length > 0) {
		return `Can't undo: no saved copy of ${unknown.join(", ")} from before this turn.`;
	}
	return null;
}

export type TurnUndoState =
	| {kind: "idle"}
	| {kind: "busy"}
	| {kind: "confirming"; sessionId: string; turnUuid: string; files: TurnUndoFile[]}
	| {kind: "done"; message: string}
	| {kind: "error"; message: string};

/** How an undo ended: reverted, or refused and why. */
export type TurnUndoSettled = Extract<TurnUndoState, {kind: "done" | "error"}>;

export interface TurnUndo {
	state: TurnUndoState;
	/** Preview the turn holding `turnUuid`: refuse, or ask to confirm with its file list. */
	start: (sessionId: string, turnUuid: string) => Promise<void>;
	confirm: () => Promise<void>;
	cancel: () => void;
}

/**
 * Upstream's turn "Undo" on the changes card:
 * preview the turn's files, refuse when any changed since the turn, otherwise
 * confirm with the file list and write the originals back.
 */
export function useTurnUndo(onSettled?: (outcome: TurnUndoSettled) => void): TurnUndo {
	const [state, setState] = useState<TurnUndoState>({kind: "idle"});
	const settle = (outcome: TurnUndoSettled) => {
		setState(outcome);
		onSettled?.(outcome);
	};

	const start = async (sessionId: string, turnUuid: string) => {
		setState({kind: "busy"});
		try {
			const {files} = await fetchTurnUndoPreview(sessionId, turnUuid);
			const reason = refusal(files);
			if (reason === null) setState({kind: "confirming", sessionId, turnUuid, files});
			else settle({kind: "error", message: reason});
		} catch {
			settle({kind: "error", message: "Couldn't check this turn's files."});
		}
	};

	const confirm = async () => {
		if (state.kind !== "confirming") return;
		const {sessionId, turnUuid} = state;
		setState({kind: "busy"});
		try {
			const outcome = await postTurnUndo(sessionId, turnUuid);
			const reason = outcome.kind === "blocked" ? refusal(outcome.files) : null;
			settle(
				outcome.kind === "reverted"
					? {kind: "done", message: `Reverted ${plural(outcome.files.length, "file")}`}
					: {kind: "error", message: reason ?? "Can't undo this turn."},
			);
		} catch {
			settle({kind: "error", message: "Couldn't undo this turn."});
		}
	};

	// Functional so the dialog's close after confirm cannot clobber the busy state.
	const cancel = () => {
		setState((current) => (current.kind === "confirming" ? {kind: "idle"} : current));
	};

	return {state, start, confirm, cancel};
}
