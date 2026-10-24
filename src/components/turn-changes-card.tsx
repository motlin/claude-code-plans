import {Code, FileText} from "lucide-react";
import {type ReactNode, useContext, useState} from "react";

import {fileViewerPath} from "../lib/api/file";
import {requestChangesScope} from "../lib/changes-scope-request";
import {formatCount} from "../lib/pluralize";
import type {TurnChanges} from "../lib/turn-changes";
import {turnUndoPrompt} from "../lib/turn-undo-prompt";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {ToastContext} from "./toast-context";
import {TurnUndoConfirm} from "./turn-undo";
import {TurnUndoSendContext} from "./turn-undo-send-context";
import {useTurnUndo} from "./use-turn-undo";
import {Tooltip} from "./ui/tooltip";

/** Upstream shows three file rows before its "See all" / "Show less" toggle. */
const VISIBLE_FILE_LIMIT = 3;

/**
 * Upstream's row store keeps each turn card's expanded state under `turn-edits:<id>`, so it survives the card
 * remounting (scrolling, re-rendering the transcript) for the life of the page.
 */
const expandedTurns = new Map<string, boolean>();

function useTurnExpanded(turnUuid: string): [boolean, (expanded: boolean) => void] {
	const key = `turn-edits:${turnUuid}`;
	const [expanded, setExpanded] = useState(() => expandedTurns.get(key) ?? false);
	return [
		expanded,
		(next) => {
			expandedTurns.set(key, next);
			setExpanded(next);
		},
	];
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

/**
 * Upstream's row folder hints: for files sharing a basename, the fewest trailing parent folders that tell them
 * apart ("a" for src/a/index.ts vs src/b/index.ts, "x/lib" for x/lib/util.ts vs y/lib/util.ts).
 */
function folderHints(paths: readonly string[]): Map<string, string> {
	const groups = new Map<string, {path: string; dirs: string[]}[]>();
	for (const path of paths) {
		const dirs = path.split("/").filter((segment) => segment !== "");
		const name = dirs.pop() ?? path;
		groups.set(name, [...(groups.get(name) ?? []), {path, dirs}]);
	}
	const hints = new Map<string, string>();
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		const depth = Math.max(...group.map(({dirs}) => dirs.length));
		for (let take = 1; take <= depth; take += 1) {
			const suffixes = group.map(({dirs}) => dirs.slice(-take).join("/"));
			if (new Set(suffixes).size === group.length || take === depth) {
				group.forEach(({path}, index) => {
					const hint = suffixes[index] ?? "";
					hints.set(path, hint === "" ? "/" : hint);
				});
				break;
			}
		}
	}
	return hints;
}

/** Upstream's DiffStat: sr-only "{n} additions, {n} deletions", the visible "+n −n" hidden from the a11y tree. */
function Stats({added, removed, className = ""}: {added: number; removed: number; className?: string}) {
	return (
		<span className={`flex shrink-0 items-center gap-0.5 tabular-nums ${className}`}>
			<span className="sr-only">{`${formatCount(added, "addition")}, ${formatCount(removed, "deletion")}`}</span>
			<span aria-hidden="true" className="contents">
				<span className="text-diff-added">+{added}</span>
				<span className="text-diff-removed">−{removed}</span>
			</span>
		</span>
	);
}

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

function RowLabel({
	icon: Icon,
	path,
	folderHint,
}: {
	icon: typeof FileText;
	path: string;
	folderHint: string | undefined;
}) {
	return (
		<span className="relative flex min-w-0 items-center gap-1">
			<span className="flex shrink-0 text-ink-muted">
				<Icon aria-hidden="true" className="size-4" />
			</span>
			<span className="min-w-0 truncate text-primary">
				{basename(path)}
				{folderHint !== undefined && (
					<span className="ms-1 text-[12px]/[15px] text-muted-as-secondary">
						<span className="sr-only">, </span>
						{folderHint}
					</span>
				)}
			</span>
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

/**
 * Upstream's end-of-turn changes card: "Edited N files", up to three file
 * rows (icon, name, stats), then a closing "See all +A −R" row that opens the
 * Changes pane scoped to this turn. With more than three files that row is a
 * toggle: "See all" opens the pane and expands, "Show less" collapses. A file
 * row opens the file viewer.
 * A one-file turn is a lone row in an outlined card with no header (79a0ad58
 * "settings.json +1 −1", its row 44px below the Denied row): a code glyph and
 * the name open the Changes pane ("View this turn's changes"), the stats and a
 * chevron sit right-aligned, and Undo is always visible.
 *
 * Undo shows only when `undoable`: upstream offers it on the session's last turn alone,
 * never on an archived session. As upstream, it sends a message asking Claude to undo
 * the turn's files when the session has a live pane. Without one it falls back to the local direct revert behind
 * a confirm, which upstream has no counterpart for (a local adaptation). Its outcome goes to a toast, so the card's
 * DOM matches upstream's in every state.
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
	const [expanded, setExpanded] = useTurnExpanded(changes.turnUuid);
	// Optional: cards rendered outside the app shell (tests, previews) have no toaster.
	const toast = useContext(ToastContext);
	const undo = useTurnUndo((outcome) => {
		toast?.({kind: outcome.kind === "done" ? "success" : "error", message: outcome.message});
	});
	const send = useContext(TurnUndoSendContext);
	const startUndo =
		send === null
			? () => void undo.start(sessionId, changes.turnUuid)
			: () => {
					send(turnUndoPrompt(changes.files.map((file) => file.path)));
				};
	const count = changes.files.length;
	const title = `Edited ${count} ${count === 1 ? "file" : "files"}`;
	const toggles = count > VISIBLE_FILE_LIMIT;
	const visible = toggles && !expanded ? changes.files.slice(0, VISIBLE_FILE_LIMIT) : changes.files;
	const openChanges =
		host === null
			? undefined
			: () => {
					requestChangesScope(sessionId, `turn:${changes.turnUuid}`);
					host.openPane("changes");
				};

	const [soleFile] = changes.files;
	if (count === 1 && soleFile !== undefined) {
		const label = <RowLabel icon={Code} path={soleFile.path} folderHint={undefined} />;
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
				<TurnUndoConfirm undo={undo} />
			</div>
		);
	}

	const hints = folderHints(changes.files.map((file) => file.path));
	const seeAllContent = (
		<>
			<span className="relative flex min-w-0 items-center">
				<span className="min-w-0 truncate text-primary">{toggles && expanded ? "Show less" : "See all"}</span>
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
							<RowLabel icon={FileText} path={file.path} folderHint={hints.get(file.path)} />
						</a>
						<RowTrailing added={file.added} removed={file.removed} />
					</li>
				))}
				<li className={ITEM_CLASS}>
					{toggles ? (
						<button
							type="button"
							aria-expanded={expanded}
							onClick={() => {
								if (!expanded) openChanges?.();
								setExpanded(!expanded);
							}}
							className={`${ROW_CONTROL_CLASS} ${SEE_ALL_CLASS} cursor-pointer`}
						>
							{seeAllContent}
						</button>
					) : openChanges === undefined ? (
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
			<TurnUndoConfirm undo={undo} />
		</div>
	);
}
