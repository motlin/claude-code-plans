import {useState} from "react";

import {fetchTurnUndoPreview, postTurnUndo, type TurnUndoFile} from "../lib/api/turn-undo";
import {ConfirmDialog} from "./confirm-dialog";

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

function plural(count: number, noun: string): string {
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
 * Upstream's turn "Undo", shared by the changes card and "Rewind to here":
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
	const cancel = () => setState((current) => (current.kind === "confirming" ? {kind: "idle"} : current));

	return {state, start, confirm, cancel};
}

/** The Undo confirm: the files the turn touched, and a red [Undo changes]. */
export function TurnUndoConfirm({undo}: {undo: TurnUndo}) {
	const files = undo.state.kind === "confirming" ? undo.state.files : [];
	return (
		<ConfirmDialog
			open={undo.state.kind === "confirming"}
			onOpenChange={(open) => {
				if (!open) undo.cancel();
			}}
			title="Undo changes from this turn?"
			body={`This restores ${plural(files.length, "file")} to how they were before this turn. Files this turn created are deleted.`}
			details={
				files.length > 0 ? (
					<ul className="flex flex-col gap-0.5 text-body text-primary">
						{files.map((file) => (
							<li key={file.path} title={file.path} className="truncate">
								{basename(file.path)}
							</li>
						))}
					</ul>
				) : undefined
			}
			confirmLabel="Undo changes"
			variant="danger"
			onConfirm={() => void undo.confirm()}
		/>
	);
}
