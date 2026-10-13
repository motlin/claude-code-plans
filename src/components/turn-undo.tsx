import {ConfirmDialog} from "./confirm-dialog";
import {type TurnUndo, plural, basename} from "./use-turn-undo";

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
