import {Code, FileText} from "lucide-react";
import {type ReactNode, useContext, useState} from "react";

import {fileViewerPath} from "../lib/api/file";
import {requestChangesScope} from "../lib/changes-scope-request";
import type {TurnChanges} from "../lib/turn-changes";
import {turnUndoPrompt} from "../lib/turn-undo-prompt";
import {useOptionalPaneHost} from "./panes/pane-host-context";
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
		<span className={`flex shrink-0 items-center gap-0.5 tabular-nums ${className}`}>
			<span className="text-diff-added">+{added}</span>
			<span className="text-diff-removed">−{removed}</span>
		</span>
	);
}

const ROW_CLASS =
	"-mx-1 flex min-h-7 w-full min-w-0 items-center gap-2 rounded-r5 px-1 py-0.5 text-left transition-colors hover:bg-fill-ghost-hover";

/** Upstream's summary card: 4px top margin, 4px 8px padding, 10px radius, 13/19 control text, inset ring. */
const CARD_CLASS =
	"mt-1 flex w-full select-text flex-col gap-1 rounded-r7 px-2 py-1 text-[13px]/[19px] shadow-[inset_0_0_0_1px_var(--color-border)]";
/** Upstream's 12/15 git stats. */
const STAT_TEXT = "text-[12px]/[15px]";
/** Upstream's file row: the control's `::before` fills the whole `<li>`, Undo and stats included, on hover. */
const ITEM_CLASS = "relative -mx-1 flex min-w-0 items-center gap-2 px-2";
const ROW_CONTROL_CLASS =
	"flex min-h-7 min-w-0 grow items-center before:absolute before:inset-0 before:rounded-r5 before:content-[''] text-start hover:before:bg-fill-ghost-hover focus-visible:before:shadow-focus focus-visible:outline-hidden";
/** The closing "See all" row: label at the start, the turn's totals at the end. */
const SEE_ALL_CLASS = "flex min-w-0 grow items-center justify-between gap-2";
const TRAILING_CLASS = "pointer-events-none relative flex shrink-0 items-center gap-1";

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

function RowLabel({icon: Icon, path}: {icon: typeof FileText; path: string}) {
	return (
		<span className="relative flex min-w-0 items-center gap-1">
			<span className="flex shrink-0 text-ink-muted">
				<Icon aria-hidden="true" className="size-4" />
			</span>
			<span className="min-w-0 truncate text-primary">{basename(path)}</span>
		</span>
	);
}

/** The row's right side: upstream's pass-through group holding Undo (when offered) and the stats. */
function RowTrailing({added, removed, undo}: {added: number; removed: number; undo?: ReactNode}) {
	return (
		<span className={TRAILING_CLASS}>
			{undo !== undefined && <span className="pointer-events-auto flex items-center gap-1">{undo}</span>}
			<span className="flex items-center gap-2.5">
				<Stats added={added} removed={removed} className={STAT_TEXT} />
			</span>
		</span>
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
		const label = <RowLabel icon={Code} path={soleFile.path} />;
		return (
			<div data-turn-changes-card className={CARD_CLASS}>
				<ul aria-label={title} className="flex w-full min-w-0 flex-col">
					<li className={ITEM_CLASS}>
						{openChanges === undefined ? (
							<a href={fileViewerPath(soleFile.path)} title={soleFile.path} className={ROW_CONTROL_CLASS}>
								{label}
							</a>
						) : (
							// Unpositioned (portalled tip) so the control's ::before spans the whole <li>.
							<Tooltip content="View this turn's changes" portal className="static! min-w-0 grow">
								<button
									type="button"
									onClick={openChanges}
									className={`${ROW_CONTROL_CLASS} cursor-pointer`}
								>
									{label}
								</button>
							</Tooltip>
						)}
						<RowTrailing
							added={soleFile.added}
							removed={soleFile.removed}
							undo={
								undoable ? (
									<UndoButton
										sendsPrompt={send !== null}
										busy={undo.state.kind === "busy"}
										onUndo={startUndo}
									/>
								) : undefined
							}
						/>
					</li>
				</ul>
				<UndoFeedback undo={undo} />
			</div>
		);
	}

	const seeAllContent = (
		<>
			<span className="relative flex min-w-0 items-center">
				<span className="min-w-0 truncate text-primary">See all</span>
			</span>
			<span className="relative flex shrink-0">
				<Stats added={changes.added} removed={changes.removed} className={STAT_TEXT} />
			</span>
		</>
	);

	// Upstream's summary card: a static "Edited N files" header with Undo flush to the card edge, a 1px divider,
	// then the file rows closing on a "See all +A −R" row inside the list.
	return (
		<div data-turn-changes-card className={CARD_CLASS}>
			<div className="flex h-6 min-w-0 items-center justify-between gap-2 px-1">
				<span className="min-w-0 truncate text-primary">{title}</span>
				{undoable && (
					<UndoButton
						sendsPrompt={send !== null}
						busy={undo.state.kind === "busy"}
						onUndo={startUndo}
						flushEnd
					/>
				)}
			</div>
			<div aria-hidden="true" className="-mx-[7px] h-px shrink-0 bg-alpha-2" />
			<ul aria-label={title} className="flex w-full min-w-0 flex-col">
				{visible.map((file) => (
					<li key={file.path} className={ITEM_CLASS}>
						<a href={fileViewerPath(file.path)} title={file.path} className={ROW_CONTROL_CLASS}>
							<RowLabel icon={FileText} path={file.path} />
						</a>
						<RowTrailing added={file.added} removed={file.removed} />
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
							className={`${ROW_CLASS} cursor-pointer text-secondary`}
						>
							Show {hidden} more
						</button>
					</li>
				)}
				<li className={ITEM_CLASS}>
					{openChanges === undefined ? (
						<div className={`${SEE_ALL_CLASS} min-h-7`}>{seeAllContent}</div>
					) : (
						<button
							type="button"
							onClick={openChanges}
							className={`${ROW_CONTROL_CLASS} ${SEE_ALL_CLASS} cursor-pointer`}
						>
							{seeAllContent}
						</button>
					)}
				</li>
			</ul>
			<UndoFeedback undo={undo} />
		</div>
	);
}
