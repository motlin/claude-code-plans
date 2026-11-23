import {QueryClientContext} from "@tanstack/react-query";
import {type ReactNode, useContext, useState} from "react";

import {fileViewerPath} from "../lib/api/file";
import {requestChangesScope} from "../lib/changes-scope-request";
import {ARTIFACT_MARK_KINDS, MARK_INK, resolveArtifactMark} from "../lib/artifact-mark";
import type {SessionArtifact} from "../lib/api/artifacts";
import {type TurnArtifactPage, type TurnChanges, turnChangesKind} from "../lib/turn-changes";
import {turnUndoPrompt} from "../lib/turn-undo-prompt";
import {DiffStat} from "./diff-stat";
import {ArtifactGlyph} from "./artifact-mark";
import {LazyFileTypeIcon} from "./lazy-file-type-icon";
import {useSessionArtifacts} from "./panes/artifacts-pane-entry";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {ToastContext} from "./toast-context";
import {TurnUndoConfirm} from "./turn-undo";
import {TurnUndoSendContext} from "./turn-undo-send-context";
import {useTurnUndo} from "./use-turn-undo";
import {CDS_BUTTON_DISABLED} from "./ui/cds-button-disabled";
import {Icon} from "./ui/icon";
import {Tooltip} from "./ui/tooltip";

/** Upstream shows three file rows before its "See all" / "Show less" toggle. */
const VISIBLE_FILE_LIMIT = 3;

/**
 * Upstream's row store keeps each turn card's expanded state under `turn-edits:<id>`, so it survives the card
 * remounting (scrolling, re-rendering the transcript) for the life of the page.
 */
const expandedTurns = new Map<string, boolean>();

/** Upstream `rX`'s ICU header, `{n, plural, one {Edited a file} other {Edited # files}}`, and its Created/Changed kin. */
const TITLE_VERB =
{
	created: "Created",
	changed: "Changed",
	edited: "Edited",
} as const;

function useTurnExpanded(turnUuid: string): [boolean, (expanded: boolean) => void]
{
	const key = `turn-edits:${turnUuid}`;
	const [expanded, setExpanded] = useState(() => expandedTurns.get(key) ?? false);
	return [
		expanded,
		(next) =>
		{
			expandedTurns.set(key, next);
			setExpanded(next);
		},
	];
}

function basename(path: string): string
{
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

/**
 * Upstream's row folder hints: for files sharing a basename, the fewest trailing parent folders that tell them
 * apart ("a" for src/a/index.ts vs src/b/index.ts, "x/lib" for x/lib/util.ts vs y/lib/util.ts).
 */
function folderHints(paths: readonly string[]): Map<string, string>
{
	const groups = new Map<
		string,
		{
			path: string;
			dirs: string[];
		}[]
	>();
	for (const path of paths)
	{
		const dirs = path.split("/").filter((segment) => segment !== "");
		const name = dirs.pop() ?? path;
		groups.set(name, [
			...(groups.get(name) ?? []),
			{
				path,
				dirs,
			},
		]);
	}
	const hints = new Map<string, string>();
	for (const group of groups.values())
	{
		if (group.length < 2) continue;
		const depth = Math.max(...group.map(({dirs}) => dirs.length));
		for (let take = 1; take <= depth; take += 1)
		{
			const suffixes = group.map(({dirs}) => dirs.slice(-take).join("/"));
			if (new Set(suffixes).size === group.length || take === depth)
			{
				group.forEach(({path}, index) =>
				{
					const hint = suffixes[index] ?? "";
					hints.set(path, hint === "" ? "/" : hint);
				});
				break;
			}
		}
	}
	return hints;
}

/** Upstream `HZ`'s stat classes: `RZ` on file rows, and `zZ` with `nX` dropping `text-footnote` for See all. */
const ROW_STATS_CLASS = "flex shrink-0 items-center gap-0.5 text-body";
const SEE_ALL_STATS_CLASS = "flex shrink-0 items-center gap-0.5";

/** Upstream's summary card: 4px top margin, 4px 8px padding, 10px radius, 13/19 control text, inset ring. */
const CARD_CLASS =
	"mt-1 flex w-full select-text flex-col gap-1 rounded-r7 px-2 py-1 text-body shadow-[inset_0_0_0_1px_var(--color-border)]";
/** Upstream's file row: the control's `::before` fills the whole `<li>`, Undo and stats included, on hover. */
const ITEM_CLASS = "relative -mx-1 flex min-w-0 items-center gap-2 px-2";
const ROW_CONTROL_CLASS =
	"flex min-h-7 min-w-0 grow items-center before:absolute before:inset-0 before:rounded-r5 before:content-[''] text-start hover:before:bg-fill-ghost-hover focus-visible:before:shadow-focus focus-visible:outline-hidden";
/** The closing "See all" row: label at the start, the turn's totals at the end. */
const SEE_ALL_CLASS = "flex min-w-0 grow items-center justify-between gap-2";
const TRAILING_CLASS = "pointer-events-none relative flex shrink-0 items-center gap-1";

/**
 * Upstream's cds ghost Button (size base) with `text-muted-as-secondary hover:text-secondary`. Its "type"
 * fizzy-lake token (`nX`) strips `text-footnote`, so Undo, the stats and folder hints inherit the card's body size.
 */
const UNDO_CLASS = `h-6 shrink-0 cursor-pointer rounded-r5 px-2 font-control-regular text-muted-as-secondary transition-shadow hover:bg-fill-ghost-hover hover:text-secondary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${CDS_BUTTON_DISABLED}`;

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
})
{
	return (
		<Tooltip
			content={sendsPrompt ? "Ask Claude to undo this turn\u2019s file changes" : "Undo this turn's file changes"}
			className="shrink-0"
		>
			<button
				type="button"
				disabled={busy}
				onMouseDown={(event) =>
				{
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

/**
 * Upstream's artifact row Open: cds secondary Button `size="xxs"` (`data-step="1"`: 20px tall, 6px padding);
 * upstream now passes only `shrink-0 text-footnote`, so Open takes cds secondary's `text-primary` ink.
 */
const OPEN_ARTIFACT_CLASS =
	"inline-flex h-5 shrink-0 cursor-pointer items-center rounded-r4 px-1.5 text-footnote text-primary bg-fill-secondary shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)] transition-shadow hover:bg-fill-secondary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

const UNTITLED_ARTIFACT = "Untitled artifact";

/**
 * Upstream `eQ`/`pZ` for the turn's artifactPage: the artifact's mark (or the Artifacts glyph), its label, the
 * "Artifact" detail, and a secondary "Open". Local has no in-app artifact pane, so both the row and Open open the
 * claude.ai URL in a new tab, upstream's own no-opener fallback.
 */
function ArtifactLeadRow({page, artifact}: {page: TurnArtifactPage; artifact: SessionArtifact | undefined})
{
	// Upstream `uQ`: the name store, else the publish's path label, else "Untitled artifact"; the DB's own
	// untitled fallback is no name.
	const title = artifact?.title === UNTITLED_ARTIFACT ? undefined : artifact?.title;
	const label = title ?? page.label ?? UNTITLED_ARTIFACT;
	const mark = resolveArtifactMark(
		{
			typeKind: artifact?.kind,
		},
	);
	const open = () =>
	{
		window.open(page.url, "_blank", "noopener,noreferrer");
	};
	return (
		<li className={ITEM_CLASS}>
			<button type="button" onClick={open} className={`${ROW_CONTROL_CLASS} cursor-pointer`}>
				<span className="relative flex min-w-0 items-center gap-1.5">
					{mark === undefined ? (
						<span className="flex shrink-0 text-muted-as-secondary">
							<Icon name="Artifacts" size="sm" />
						</span>
					) : (
						<span className={`flex shrink-0 ${MARK_INK[mark.hue]}`}>
							<span data-artifact-mark={mark.kind} className="flex">
								<ArtifactGlyph icon={ARTIFACT_MARK_KINDS[mark.kind].icon} size="sm" />
							</span>
						</span>
					)}
					<span className="min-w-0 truncate text-primary">{label}</span>
					<span className="shrink-0 whitespace-nowrap text-muted-as-secondary">Artifact</span>
				</span>
			</button>
			<span className={TRAILING_CLASS}>
				<span className="pointer-events-auto flex items-center gap-1">
					<Tooltip content={`Open artifact ${label}`} className="shrink-0">
						<button
							type="button"
							aria-label={`Open artifact ${label}`}
							onClick={open}
							className={OPEN_ARTIFACT_CLASS}
						>
							Open
						</button>
					</Tooltip>
				</span>
			</span>
		</li>
	);
}

/** The lead row with the session's own record of the artifact, for its title and type. */
function StoredArtifactLeadRow({sessionId, page}: {sessionId: string; page: TurnArtifactPage})
{
	const artifact = useSessionArtifacts(sessionId).find((entry) => entry.url === page.url);
	return <ArtifactLeadRow page={page} artifact={artifact} />;
}

function TurnArtifactRow({sessionId, page}: {sessionId: string; page: TurnArtifactPage})
{
	// Optional: cards rendered outside the app shell (tests, previews) have no query client.
	return useContext(QueryClientContext) === undefined ? (
		<ArtifactLeadRow page={page} artifact={undefined} />
	) : (
		<StoredArtifactLeadRow sessionId={sessionId} page={page} />
	);
}

function RowLabel({icon, path, folderHint}: {icon: ReactNode; path: string; folderHint: string | undefined})
{
	return (
		<span className="relative flex min-w-0 items-center gap-1">
			<span className="flex shrink-0 text-ink-muted">{icon}</span>
			<span className="min-w-0 truncate text-primary">
				{basename(path)}
				{folderHint !== undefined && (
					<span className="ms-1 text-muted-as-secondary">
						<span className="sr-only">, </span>
						{folderHint}
					</span>
				)}
			</span>
		</span>
	);
}

/** The row's right side: upstream's pass-through group holding Undo (when offered) and the stats. */
function RowTrailing({
	added,
	removed,
	undo,
	statsClass = ROW_STATS_CLASS,
}: {
	added: number;
	removed: number;
	undo?: ReactNode;
	/** Upstream `bQ seeAllForm`: a single-file card's row takes the See-all stat class (no text-body). */
	statsClass?: string;
})
{
	return (
		<span className={TRAILING_CLASS}>
			{undo !== undefined && <span className="pointer-events-auto flex items-center gap-1">{undo}</span>}
			<span className="flex items-center gap-2.5">
				<DiffStat added={added} removed={removed} className={statsClass} hideZeroSide />
			</span>
		</span>
	);
}

/**
 * Upstream's end-of-turn changes card: "Edited N files" (or Created/Changed), up to three file
 * rows (icon, name, stats), then a closing "See all +A −R" row that opens the
 * Changes pane scoped to this turn. With more than three files that row is a
 * toggle: "See all" opens the pane and expands, "Show less" collapses. A file
 * row opens the file viewer.
 * A one-file turn is a lone row in an outlined card with no header (79a0ad58
 * "settings.json +1 −1", its row 44px below the Denied row): its file-type glyph and
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
})
{
	const host = useOptionalPaneHost();
	const [expanded, setExpanded] = useTurnExpanded(changes.turnUuid);
	// Optional: cards rendered outside the app shell (tests, previews) have no toaster.
	const toast = useContext(ToastContext);
	const undo = useTurnUndo((outcome) =>
	{
		toast?.(
			{
				kind: outcome.kind === "done" ? "success" : "error",
				message: outcome.message,
			},
		);
	});
	const send = useContext(TurnUndoSendContext);
	const startUndo =
		send === null
			? () => void undo.start(sessionId, changes.turnUuid)
			: () =>
				{
					send(turnUndoPrompt(changes.files.map((file) => file.path)));
				};
	const page = changes.artifactPage;
	// Upstream hides Undo whenever the turn published an artifact.
	const offersUndo = undoable && page === undefined;
	const count = changes.files.length;
	const title = `${TITLE_VERB[turnChangesKind(changes.files)]} ${count === 1 ? "a file" : `${count} files`}`;
	const toggles = count > VISIBLE_FILE_LIMIT;
	const visible = toggles && !expanded ? changes.files.slice(0, VISIBLE_FILE_LIMIT) : changes.files;
	const openChanges =
		host === null
			? undefined
			: () =>
				{
					requestChangesScope(sessionId, `turn:${changes.turnUuid}`);
					host.openPane("changes");
				};

	const [soleFile] = changes.files;
	if (count === 1 && soleFile !== undefined && page === undefined)
	{
		const label = (
			<RowLabel
				icon={<LazyFileTypeIcon fileName={soleFile.path} size="sm" />}
				path={soleFile.path}
				folderHint={undefined}
			/>
		);
		return (
			<div data-turn-changes-card className={CARD_CLASS}>
				<ul aria-label={title} className="flex w-full min-w-0 flex-col">
					<li className={ITEM_CLASS}>
						{openChanges === undefined ? (
							<a
								href={fileViewerPath(soleFile.path)}
								title={soleFile.path}
								data-transcript-step-navigates=""
								className={ROW_CONTROL_CLASS}
							>
								{label}
							</a>
						) : (
							// Unpositioned (portalled tip) so the control's ::before spans the whole <li>.
							<Tooltip content="View this turn's changes" portal className="static! min-w-0 grow">
								<button
									type="button"
									data-transcript-step-navigates=""
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
							statsClass={SEE_ALL_STATS_CLASS}
							undo={
								offersUndo ? (
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
				<DiffStat
					added={changes.added}
					removed={changes.removed}
					className={SEE_ALL_STATS_CLASS}
					hideZeroSide
				/>
			</span>
		</>
	);

	// Upstream's summary card: a static "Edited N files" header with Undo flush to the card edge, a 1px divider,
	// then the file rows closing on a "See all +A −R" row inside the list.
	// With an artifact page upstream draws no header or divider; the artifact row leads the list.
	return (
		<div data-turn-changes-card className={CARD_CLASS}>
			{page === undefined && (
				<>
					<div className="flex h-6 min-w-0 items-center justify-between gap-2 px-1">
						<span className="min-w-0 truncate text-primary">{title}</span>
						{offersUndo && (
							<UndoButton
								sendsPrompt={send !== null}
								busy={undo.state.kind === "busy"}
								onUndo={startUndo}
								flushEnd
							/>
						)}
					</div>
					<div aria-hidden="true" className="-mx-[7px] h-px shrink-0 bg-alpha-2" />
				</>
			)}
			<ul aria-label={title} className="flex w-full min-w-0 flex-col">
				{page !== undefined && <TurnArtifactRow sessionId={sessionId} page={page} />}
				{visible.map((file) => (
					<li key={file.path} className={ITEM_CLASS}>
						<a
							href={fileViewerPath(file.path)}
							title={file.path}
							data-transcript-step-navigates=""
							className={ROW_CONTROL_CLASS}
						>
							<RowLabel
								icon={<LazyFileTypeIcon fileName={file.path} size="sm" />}
								path={file.path}
								folderHint={hints.get(file.path)}
							/>
						</a>
						<RowTrailing added={file.added} removed={file.removed} />
					</li>
				))}
				<li className={ITEM_CLASS}>
					{toggles ? (
						<button
							type="button"
							aria-expanded={expanded}
							onClick={() =>
							{
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
							data-transcript-step-navigates=""
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
