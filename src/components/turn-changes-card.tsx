import {ChevronRight, Code, FileText} from "lucide-react";
import {useContext, useState} from "react";

import {fileViewerPath} from "../lib/api/file";
import {requestChangesScope} from "../lib/changes-scope-request";
import {TOUCH_REVEAL} from "../lib/touch-reveal";
import type {TurnChanges} from "../lib/turn-changes";
import {turnUndoPrompt} from "../lib/turn-undo-prompt";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {ChevronIcon} from "./tool-renderers/shared";
import {TurnUndoConfirm} from "./turn-undo";
import {TurnUndoSendContext} from "./turn-undo-send-context";
import {useTurnUndo} from "./use-turn-undo";
import {Tooltip} from "./ui/tooltip";

/** Upstream shows four file rows before "Show N more". */
const VISIBLE_FILE_LIMIT = 4;

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

function Stats({added, removed, className = ""}: {added: number; removed: number; className?: string}) {
	return (
		<span className={`flex shrink-0 gap-g1 tabular-nums ${className}`}>
			<span className="text-diff-added">+{added}</span>
			<span className="text-diff-removed">−{removed}</span>
		</span>
	);
}

const ROW_CLASS =
	"group/row -mx-1 flex min-h-7 w-full min-w-0 items-center gap-2 rounded-r5 px-1 py-0.5 text-left transition-colors hover:bg-fill-ghost-hover";

/** Upstream's summary-card control text: 13/19 rows over 12/15 git stats. */
const CONTROL_TEXT = "text-[13px]/[19px]";
const STAT_TEXT = "text-[12px]/[15px]";

/** Upstream's cds ghost Button (size base) with `text-muted-as-secondary hover:text-secondary text-footnote`. */
const UNDO_CLASS =
	"h-6 shrink-0 cursor-pointer rounded-r5 px-2 text-[12px]/[15px] text-muted-as-secondary transition-shadow hover:bg-fill-ghost-hover hover:text-secondary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus disabled:cursor-default disabled:opacity-50";

/**
 * Upstream's Undo: tooltipped "Ask Claude to undo this turn’s file changes", and pressing it keeps focus in the
 * composer (`onMouseDown: preventDefault`). The no-live-pane fallback reverts directly, so it says so instead.
 */
function UndoButton({
	sendsPrompt,
	busy,
	onUndo,
	flushEnd = false,
}: {
	sendsPrompt: boolean;
	busy: boolean;
	onUndo: () => void;
	flushEnd?: boolean;
}) {
	return (
		<Tooltip
			content={sendsPrompt ? "Ask Claude to undo this turn\u2019s file changes" : "Undo this turn's file changes"}
			className="shrink-0"
		>
			<button
				type="button"
				disabled={busy}
				onMouseDown={(event) => {
					event.preventDefault();
				}}
				onClick={onUndo}
				className={flushEnd ? `${UNDO_CLASS} -me-2` : UNDO_CLASS}
			>
				Undo
			</button>
		</Tooltip>
	);
}

/** Upstream's lone changes row: a 16px code glyph and the name, its stats and chevron outside the button. */
const LONE_ROW_CLASS =
	"flex min-h-7 min-w-0 grow items-center gap-1.5 rounded-r4 py-0.5 text-left transition-colors hover:bg-fill-ghost-hover";

function FileRowContent({path, added, removed}: {path: string; added: number; removed: number}) {
	return (
		<>
			<FileText aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
			<span className={`min-w-0 truncate ${CONTROL_TEXT} text-primary`}>{basename(path)}</span>
			<Stats added={added} removed={removed} className={STAT_TEXT} />
			<ChevronRight
				aria-hidden="true"
				className={`ml-auto size-3.5 shrink-0 text-ink-muted opacity-0 group-hover/row:opacity-100 ${TOUCH_REVEAL}`}
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
 * chevron sit right-aligned, and Undo is always visible.
 *
 * Undo shows only when `undoable`: upstream offers it on the session's last turn alone,
 * never on an archived session. As upstream, it sends a message asking Claude to undo
 * the turn's files when the session has a live pane. Without one it falls back to the local direct revert behind
 * a confirm, which upstream has no counterpart for.
 */
export function TurnChangesCard({
	sessionId,
	changes,
	undoable,
}: {
	sessionId: string;
	changes: TurnChanges;
	undoable: boolean;
}) {
	const host = useOptionalPaneHost();
	const [showAll, setShowAll] = useState(false);
	const undo = useTurnUndo();
	const send = useContext(TurnUndoSendContext);
	const startUndo =
		send === null
			? () => void undo.start(sessionId, changes.turnUuid)
			: () => {
					send(turnUndoPrompt(changes.files.map((file) => file.path)));
				};
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

	const [soleFile] = changes.files;
	if (count === 1 && soleFile !== undefined) {
		const name = (
			<>
				<Code aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
				<span className="min-w-0 truncate text-body text-primary">{basename(soleFile.path)}</span>
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
							<a href={fileViewerPath(soleFile.path)} title={soleFile.path} className={LONE_ROW_CLASS}>
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
							<Stats added={soleFile.added} removed={soleFile.removed} />
							<span className="text-secondary">
								<ChevronIcon expanded={false} />
							</span>
						</span>
						{undoable && (
							<UndoButton
								sendsPrompt={send !== null}
								busy={undo.state.kind === "busy"}
								onUndo={startUndo}
							/>
						)}
					</li>
				</ul>
				<UndoFeedback undo={undo} />
			</div>
		);
	}

	const headerContent = <span className={`min-w-0 truncate ${CONTROL_TEXT} text-primary`}>{title}</span>;
	const seeAllContent = (
		<>
			<span className={`${CONTROL_TEXT} text-primary`}>See all</span>
			<Stats added={changes.added} removed={changes.removed} className={STAT_TEXT} />
		</>
	);

	// Upstream's summary card: an inset-ringed 10px card of 13/19 rows closing on "See all +A −R".
	// Undo is a local extra beside the header.
	return (
		<div
			data-turn-changes-card
			className="mt-2 flex w-full select-text flex-col gap-1 rounded-r7 px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--color-border)]"
		>
			<div className="flex min-w-0 items-center gap-1">
				{openChanges === undefined ? (
					<div className="flex min-h-7 min-w-0 flex-1 items-center gap-2">{headerContent}</div>
				) : (
					<button type="button" onClick={openChanges} className={`${ROW_CLASS} flex-1 cursor-pointer`}>
						{headerContent}
						<ChevronRight aria-hidden="true" className="ml-auto size-3.5 shrink-0 text-ink-muted" />
					</button>
				)}
				{undoable && (
					<UndoButton
						sendsPrompt={send !== null}
						busy={undo.state.kind === "busy"}
						onUndo={startUndo}
						flushEnd
					/>
				)}
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
							onClick={() => {
								setShowAll(true);
							}}
							className={`${ROW_CLASS} cursor-pointer ${CONTROL_TEXT} text-secondary`}
						>
							Show {hidden} more
						</button>
					</li>
				)}
			</ul>
			{openChanges === undefined ? (
				<div className="flex min-h-7 min-w-0 items-center gap-2">{seeAllContent}</div>
			) : (
				<button type="button" onClick={openChanges} className={`${ROW_CLASS} cursor-pointer`}>
					{seeAllContent}
				</button>
			)}
		</div>
	);
}
