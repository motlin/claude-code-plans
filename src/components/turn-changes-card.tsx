import {ChevronRight, Code, FileText} from "lucide-react";
import {useState} from "react";

import {fileViewerPath} from "../lib/api/file";
import {requestChangesScope} from "../lib/changes-scope-request";
import type {TurnChanges} from "../lib/turn-changes";
import {useOptionalPaneHost} from "./panes/tile-host";
import {ChevronIcon} from "./tool-renderers/shared";
import {TurnUndoConfirm, useTurnUndo} from "./turn-undo";
import {Tooltip} from "./ui/tooltip";

/** Upstream shows four file rows before "Show N more". */
const VISIBLE_FILE_LIMIT = 4;

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

function Stats({added, removed}: {added: number; removed: number}) {
	return (
		<span className="flex shrink-0 gap-g1 tabular-nums">
			<span className="text-diff-added">+{added}</span>
			<span className="text-diff-removed">−{removed}</span>
		</span>
	);
}

const ROW_CLASS =
	"group/row flex min-h-7 w-full min-w-0 items-center gap-2 rounded-r5 px-2 py-0.5 text-left transition-colors hover:bg-fill-ghost-hover";

const UNDO_CLASS =
	"h-7 shrink-0 cursor-pointer rounded-r5 px-2 text-body text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary disabled:cursor-default disabled:opacity-50";

/** Upstream's lone changes row: a 16px code glyph and the name, its stats and chevron outside the button. */
const LONE_ROW_CLASS =
	"flex min-h-7 min-w-0 grow items-center gap-1.5 rounded-r4 py-0.5 text-left transition-colors hover:bg-fill-ghost-hover";

function FileRowContent({path, added, removed}: {path: string; added: number; removed: number}) {
	return (
		<>
			<FileText aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
			<span className="min-w-0 truncate text-body text-primary">{basename(path)}</span>
			<Stats added={added} removed={removed} />
			<ChevronRight
				aria-hidden="true"
				className="ml-auto size-3.5 shrink-0 text-ink-muted opacity-0 group-hover/row:opacity-100"
			/>
		</>
	);
}

function UndoFeedback({undo}: {undo: ReturnType<typeof useTurnUndo>}) {
	return (
		<>
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
		</>
	);
}

/**
 * Upstream's end-of-turn changes card: "Edited N files +A −R", up to four
 * file rows (icon, name, stats, chevron) and "Show N more". The header opens
 * the Changes pane scoped to this turn; a file row opens the file viewer.
 * A one-file turn is a lone row in an outlined card with no header (79a0ad58
 * "settings.json +1 −1", its row 44px below the Denied row): a code glyph and
 * the name open the Changes pane ("View this turn's changes"), the stats and a
 * chevron sit right-aligned, and Undo, which upstream does not draw on an
 * archived session, stays hidden until hover or focus.
 */
export function TurnChangesCard({sessionId, changes}: {sessionId: string; changes: TurnChanges}) {
	const host = useOptionalPaneHost();
	const [showAll, setShowAll] = useState(false);
	const undo = useTurnUndo();
	const count = changes.files.length;
	const title = `Edited ${count} ${count === 1 ? "file" : "files"}`;
	const visible = showAll ? changes.files : changes.files.slice(0, VISIBLE_FILE_LIMIT);
	const hidden = count - visible.length;
	const openChanges =
		host === null
			? undefined
			: () => {
					requestChangesScope(sessionId, `turn:${changes.turnUuid}`);
					host.openPane("changes");
				};

	if (count === 1) {
		const file = changes.files[0]!;
		const name = (
			<>
				<Code aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
				<span className="min-w-0 truncate text-body text-primary">{basename(file.path)}</span>
			</>
		);
		return (
			<div
				data-turn-changes-card
				className="group/card mt-4 mb-[7px] flex w-full select-text flex-col gap-1 rounded-r6 px-2 py-1 shadow-[inset_0_0_0_1px_var(--color-border)]"
			>
				<ul aria-label={title} className="flex flex-col">
					<li className="relative -mx-1 flex min-w-0 items-center gap-1 px-1">
						{openChanges === undefined ? (
							<a href={fileViewerPath(file.path)} title={file.path} className={LONE_ROW_CLASS}>
								{name}
							</a>
						) : (
							<Tooltip content="View this turn's changes" className="min-w-0 grow">
								<button
									type="button"
									onClick={openChanges}
									className={`${LONE_ROW_CLASS} cursor-pointer`}
								>
									{name}
								</button>
							</Tooltip>
						)}
						<span className="pointer-events-none flex shrink-0 items-center gap-1">
							<Stats added={file.added} removed={file.removed} />
							<span className="text-secondary">
								<ChevronIcon expanded={false} />
							</span>
						</span>
						<button
							type="button"
							disabled={undo.state.kind === "busy"}
							onClick={() => void undo.start(sessionId, changes.turnUuid)}
							className={`${UNDO_CLASS} sr-only group-hover/card:not-sr-only focus-visible:not-sr-only`}
						>
							Undo
						</button>
					</li>
				</ul>
				<UndoFeedback undo={undo} />
			</div>
		);
	}

	const headerContent = (
		<>
			<span className="min-w-0 truncate text-body text-primary">{title}</span>
			<Stats added={changes.added} removed={changes.removed} />
		</>
	);

	return (
		<div data-turn-changes-card className="mt-2 flex w-full flex-col">
			<div className="flex min-w-0 items-center gap-1">
				{openChanges === undefined ? (
					<div className="flex min-h-7 min-w-0 flex-1 items-center gap-2 px-2">{headerContent}</div>
				) : (
					<button type="button" onClick={openChanges} className={`${ROW_CLASS} flex-1 cursor-pointer`}>
						{headerContent}
						<ChevronRight aria-hidden="true" className="ml-auto size-3.5 shrink-0 text-ink-muted" />
					</button>
				)}
				<button
					type="button"
					disabled={undo.state.kind === "busy"}
					onClick={() => void undo.start(sessionId, changes.turnUuid)}
					className={UNDO_CLASS}
				>
					Undo
				</button>
			</div>
			<UndoFeedback undo={undo} />
			<ul aria-label={title} className="flex flex-col">
				{visible.map((file) => (
					<li key={file.path} className="flex min-w-0">
						<a href={fileViewerPath(file.path)} title={file.path} className={ROW_CLASS}>
							<FileRowContent {...file} />
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
