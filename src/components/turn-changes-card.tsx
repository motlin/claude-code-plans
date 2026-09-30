import {ChevronRight, FileText} from "lucide-react";
import {useState} from "react";

import {fileViewerPath} from "../lib/api/file";
import {requestChangesScope} from "../lib/changes-scope-request";
import type {TurnChanges} from "../lib/turn-changes";
import {useOptionalPaneHost} from "./panes/tile-host";
import {TurnUndoConfirm, useTurnUndo} from "./turn-undo";

/** Upstream shows four file rows before "Show N more". */
const VISIBLE_FILE_LIMIT = 4;

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

function Stats({added, removed}: {added: number; removed: number}) {
	return (
		<span className="flex shrink-0 gap-g1 tabular-nums">
			<span className="text-diff-added">+{added}</span>
			<span className="text-diff-removed">-{removed}</span>
		</span>
	);
}

const ROW_CLASS =
	"group/row flex min-h-7 w-full min-w-0 items-center gap-2 rounded-r5 px-2 py-0.5 text-left transition-colors hover:bg-fill-ghost-hover";

/**
 * Upstream's end-of-turn changes card: "Edited N files +A -R", up to four
 * file rows (icon, name, stats, chevron) and "Show N more". The header opens
 * the Changes pane scoped to this turn; a file row opens the file viewer.
 */
export function TurnChangesCard({sessionId, changes}: {sessionId: string; changes: TurnChanges}) {
	const host = useOptionalPaneHost();
	const [showAll, setShowAll] = useState(false);
	const undo = useTurnUndo();
	const count = changes.files.length;
	const title = `Edited ${count} ${count === 1 ? "file" : "files"}`;
	const visible = showAll ? changes.files : changes.files.slice(0, VISIBLE_FILE_LIMIT);
	const hidden = count - visible.length;

	const headerContent = (
		<>
			<span className="min-w-0 truncate text-body text-primary">{title}</span>
			<Stats added={changes.added} removed={changes.removed} />
		</>
	);

	return (
		<div data-turn-changes-card className="mt-2 flex w-full flex-col">
			<div className="flex min-w-0 items-center gap-1">
				{host === null ? (
					<div className="flex min-h-7 min-w-0 flex-1 items-center gap-2 px-2">{headerContent}</div>
				) : (
					<button
						type="button"
						onClick={() => {
							requestChangesScope(sessionId, `turn:${changes.turnUuid}`);
							host.openPane("changes");
						}}
						className={`${ROW_CLASS} flex-1 cursor-pointer`}
					>
						{headerContent}
						<ChevronRight aria-hidden="true" className="ml-auto size-3.5 shrink-0 text-ink-muted" />
					</button>
				)}
				<button
					type="button"
					disabled={undo.state.kind === "busy"}
					onClick={() => void undo.start(sessionId, changes.turnUuid)}
					className="h-7 shrink-0 cursor-pointer rounded-r5 px-2 text-body text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:cursor-default disabled:opacity-50"
				>
					Undo
				</button>
			</div>
			{undo.state.kind === "done" && (
				<p role="status" className="px-2 text-body text-secondary">
					{undo.state.message}
				</p>
			)}
			{undo.state.kind === "error" && (
				<p role="alert" className="px-2 text-body text-danger-000">
					{undo.state.message}
				</p>
			)}
			<TurnUndoConfirm undo={undo} />
			<ul aria-label={title} className="flex flex-col">
				{visible.map((file) => (
					<li key={file.path} className="flex min-w-0">
						<a href={fileViewerPath(file.path)} title={file.path} className={ROW_CLASS}>
							<FileText aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
							<span className="min-w-0 truncate text-body text-primary">{basename(file.path)}</span>
							<Stats added={file.added} removed={file.removed} />
							<ChevronRight
								aria-hidden="true"
								className="ml-auto size-3.5 shrink-0 text-ink-muted opacity-0 group-hover/row:opacity-100"
							/>
						</a>
					</li>
				))}
				{hidden > 0 && (
					<li className="flex min-w-0">
						<button
							type="button"
							aria-expanded={false}
							onClick={() => setShowAll(true)}
							className={`${ROW_CLASS} cursor-pointer text-body text-secondary`}
						>
							Show {hidden} more
						</button>
					</li>
				)}
			</ul>
		</div>
	);
}
