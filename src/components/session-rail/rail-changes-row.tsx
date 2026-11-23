import {Diff, Ellipsis} from "lucide-react";
import {type KeyboardEvent, type ReactNode, useId} from "react";

import {useShortcutKeys} from "../../hooks/use-shortcut";
import {writeClipboardText} from "../../lib/clipboard";
import {gitPrState, type GitPrState} from "../../lib/pr-status";
import type {PullRequestState} from "../../lib/session-state";
import {AnimatedDiffStat} from "../diff-stat";
import {GIT_PR_STATE_LABELS} from "../git-pr-state-labels";
import {useToast} from "../toast-context";
import {cdsButtonClass} from "../ui/cds-button";
import {Icon, type IconName} from "../ui/icon";
import {ContextMenu, ContextMenuTrigger, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";
import {RailGlyph} from "./rail-row";

/*
 * Upstream's flat-rail Changes row (`gr` row form, `div[data-rail-changes-row]`): the plus-minus glyph, an
 * optional repo label, a ghost xxs stat button that opens the Changes pane, a spacer, and an sr-only "…" menu
 * that also opens on right-click. Upstream draws a stacked form instead in a non-flat rail; this account's live
 * rail is flat, so the docked rail draws the row form too. With a PR linked, `gr` draws the stacked form
 * (`RailChangesPrRow`): the PR glyph and title link over a footnote line with "#N" and the stat.
 */

/**
 * Upstream `k` (`min-h-6.5 gap-sm px-xs`) as the rail card's section overrides resolve it: `min-h-list-row`
 * (32px), the `--rail-word-gap` column gap (10px) and the `--rail-row-pad` inline pad (8px).
 */
const ROW_CLASS = "flex min-h-8 w-full min-w-0 items-center gap-sm gap-x-2.5 px-2 text-body";
/** Upstream's ghost xxs flush-both stat button; `-mx-1.5` is `mx-outset` at the 6px xxs pad. */
const STAT_BUTTON_CLASS = `${cdsButtonClass("ghost", "sm")} -mx-1.5 [--upstream-radius:var(--radius-r4)]`;
/** Upstream: hidden until something inside has focus or its popup is open; never on hover. */
const MENU_WRAPPER_CLASS = "sr-only flex shrink-0 focus-within:not-sr-only has-[[data-popup-open]]:not-sr-only";
const MENU_TRIGGER_CLASS =
	"flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 text-secondary hover:bg-fill-ghost-hover hover:text-primary data-[popup-open]:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's "Open changes, {added, number} added, {removed, number} removed" (`+7hgPw`) groups its counts. */
const count = new Intl.NumberFormat("en-US");

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/** Upstream `vr`: arrows, Home and End rove focus among the row's controls. */
function roveFocus(event: KeyboardEvent<HTMLElement>): void
{
	const row = event.currentTarget;
	// React bubbles portalled menu keys through here; leave them to the menu.
	if (!(event.target instanceof Node) || !row.contains(event.target)) return;
	const controls = [...row.querySelectorAll<HTMLElement>("button, a[href]")];
	const target = event.target;
	const index = controls.findIndex((control) => control === target);
	if (index === -1) return;
	let next: number;
	if (NEXT_KEYS.has(event.key)) next = Math.min(index + 1, controls.length - 1);
	else if (PREVIOUS_KEYS.has(event.key)) next = Math.max(index - 1, 0);
	else if (event.key === "Home") next = 0;
	else if (event.key === "End") next = controls.length - 1;
	else return;
	event.preventDefault();
	controls[next]?.focus();
}

/** Upstream's ghost xxs flush-both stat button: "Open changes" with the toggle-changes keys; keeps focus on click. */
function ChangesStatButton({
	added,
	removed,
	statClassName,
	onOpen,
}: {
	added: number;
	removed: number;
	statClassName: string;
	onOpen: () => void;
})
{
	const {keys, ariaKeyShortcuts} = useShortcutKeys("toggle_changes");
	return (
		<Tooltip content="Open changes" shortcut={keys}>
			<button
				type="button"
				className={STAT_BUTTON_CLASS}
				aria-label={`Open changes, ${count.format(added)} added, ${count.format(removed)} removed`}
				aria-keyshortcuts={ariaKeyShortcuts}
				onMouseDown={(event) =>
				{
					// Upstream `zu`: a click leaves focus where it was.
					event.preventDefault();
				}}
				onClick={onOpen}
			>
				<AnimatedDiffStat added={added} removed={removed} className={statClassName} />
			</button>
		</Tooltip>
	);
}

export function RailChangesRow({
	added,
	removed,
	branch,
	repoName,
	onOpen,
}: {
	added: number;
	removed: number;
	branch: string | null;
	/** Shown only for a multi-checkout session (upstream `hideRepo`). */
	repoName?: string | undefined;
	onOpen: () => void;
})
{
	const repoLabelId = useId();
	const subject = branch ?? "changes";
	const menuLabel =
		repoName === undefined ? `More options for ${subject}` : `More options for ${repoName} on ${subject}`;
	const items = <MenuItem onSelect={onOpen}>View changes</MenuItem>;
	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={<div />}
				role="none"
				className="flex min-w-0 flex-col gap-sm"
				onKeyDown={roveFocus}
			>
				<div
					data-rail-changes-row=""
					className={ROW_CLASS}
					{...(repoName !== undefined &&
					{
						role: "group",
						"aria-labelledby": repoLabelId,
					})}
				>
					<RailGlyph glyph="ChangesPlusMinus">
						<Diff aria-hidden />
					</RailGlyph>
					{repoName !== undefined && (
						<span className="min-w-0 text-muted-as-secondary">
							<span
								id={repoLabelId}
								className="block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap"
							>
								{repoName}
							</span>
						</span>
					)}
					<ChangesStatButton
						added={added}
						removed={removed}
						statClassName="inline-flex shrink-0 gap-1 text-body"
						onOpen={onOpen}
					/>
					<span aria-hidden="true" className="flex-1" />
					<span className={MENU_WRAPPER_CLASS}>
						<Menu>
							<Tooltip content={menuLabel} suppressAfterPopup>
								<MenuTrigger aria-label={menuLabel} className={MENU_TRIGGER_CLASS}>
									<Ellipsis aria-hidden className="size-4" />
								</MenuTrigger>
							</Tooltip>
							<MenuContent side="bottom" align="end">
								{items}
							</MenuContent>
						</Menu>
					</span>
				</div>
			</ContextMenuTrigger>
			<MenuContent>{items}</MenuContent>
		</ContextMenu>
	);
}

/** Upstream `Xs`: each PR state's glyph and its `--cds-text-git-*` tint (`r.glyph`, `r.tint.text`). */
const PR_GLYPHS =
{
	opened:
	{
		icon: "GitPullRequest",
		tint: "text-git-opened",
	},
	draft:
	{
		icon: "GitPullRequestDraft",
		tint: "text-git-draft",
	},
	merged:
	{
		icon: "GitMergedSimple",
		tint: "text-git-merged",
	},
	closed:
	{
		icon: "GitPullRequestClosed",
		tint: "text-git-closed",
	},
	conflicting:
	{
		icon: "GitMergeConflict",
		tint: "text-git-conflicting",
	},
	queued:
	{
		icon: "GitMergeQueue",
		tint: "text-git-queued",
	},
} satisfies Record<
	GitPrState,
	{
		icon: IconName;
		tint: string;
	}
>;

/** Upstream `gr`'s stacked form: the row footnote's "{repo} #N" wrap box. */
const WRAP_BOX_CLASS =
	"-my-0.5 flex h-5 min-w-0 flex-wrap content-start items-center gap-x-1.5 gap-y-1 overflow-y-clip focus-within:flex-nowrap focus-within:overflow-y-visible";

/** Upstream `xr`'s pullRequest group (Open on GitHub, Copy link) then its changes group (View changes). */
function PrMenuItems({url, onOpenChanges}: {url: string; onOpenChanges: (() => void) | undefined}): ReactNode
{
	const toast = useToast();
	return (
		<>
			<MenuItem
				onSelect={() =>
				{
					window.open(url, "_blank", "noopener,noreferrer");
				}}
			>
				Open on GitHub
			</MenuItem>
			<MenuItem
				onSelect={() =>
				{
					void writeClipboardText(url).then((copied) =>
					{
						toast(
							copied
								?
									{
										kind: "success",
										message: "Link copied to clipboard.",
									}
								:
									{
										kind: "error",
										message: "Couldn’t copy the link. Try again.",
									},
						);
					});
				}}
			>
				Copy link
			</MenuItem>
			{onOpenChanges !== undefined && (
				<>
					<MenuSeparator />
					<MenuItem onSelect={onOpenChanges}>View changes</MenuItem>
				</>
			)}
		</>
	);
}

/**
 * Upstream `gr`'s stacked form for a linked PR: a tinted PR glyph, the PR title link with an always-visible "…" menu,
 * and a footnote line with "#N" and the checkout's stat button. The row is a `role=group` labelled by its title and
 * repo only for a multi-checkout session (upstream `hideRepo`).
 */
export function RailChangesPrRow({
	url,
	number,
	title,
	prState,
	diff,
	repoName,
	onOpen,
}: {
	url: string;
	number: number;
	/** The PR title, else the branch (upstream `prTitle ?? branchTitle`). */
	title: string;
	prState: PullRequestState;
	diff:
	{
		added: number;
		removed: number;
	} | null;
	repoName?: string | undefined;
	onOpen: () => void;
})
{
	const titleId = useId();
	const repoId = useId();
	const grouped = repoName !== undefined;
	const state = gitPrState(prState);
	const glyph = PR_GLYPHS[state];
	const menuLabel = `More options for ${title}`;
	const items = <PrMenuItems url={url} onOpenChanges={diff === null ? undefined : onOpen} />;
	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={<div />}
				// Upstream `gap-sm px-xs py-1` with the rail card's `--rail-word-gap` (10px) and `--rail-row-pad` (8px) overrides.
				className="flex min-w-0 gap-sm gap-x-2.5 px-2 py-1"
				{...(grouped &&
				{
					role: "group",
					"aria-labelledby": `${titleId} ${repoId}`,
				})}
			>
				{/* Upstream: the raw PR state names the glyph; the slot has no text-secondary, the inner glyph tints itself. */}
				<span
					className="flex size-5 shrink-0 items-center justify-center"
					data-rail-glyph={`pull-request-${prState}`}
				>
					<span
						role="img"
						aria-label={GIT_PR_STATE_LABELS[state]}
						className={`inline-flex shrink-0 ${glyph.tint}`}
					>
						<Icon name={glyph.icon} size="sm" />
					</span>
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-sm">
					<div className="flex min-w-0 flex-col gap-0.5">
						<div className="flex h-5 min-w-0 items-center gap-sm">
							<span
								{...(grouped &&
								{
									id: titleId,
								})}
								className="flex min-w-0 flex-1"
							>
								<a
									href={url}
									target="_blank"
									rel="noopener noreferrer"
									className="min-w-0 text-primary hover:underline focus-visible:underline focus-visible:outline-hidden"
								>
									<span className="block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap">
										{title}
									</span>
								</a>
							</span>
							<Menu>
								<Tooltip content={menuLabel} suppressAfterPopup>
									<MenuTrigger aria-label={menuLabel} className={`${MENU_TRIGGER_CLASS} -my-0.5`}>
										<Ellipsis aria-hidden className="size-4" />
									</MenuTrigger>
								</Tooltip>
								<MenuContent side="bottom" align="end">
									{items}
								</MenuContent>
							</Menu>
						</div>
						<div className="flex min-h-4 min-w-0 items-center gap-1.5 text-footnote text-muted-as-secondary">
							<div className={WRAP_BOX_CLASS}>
								<span
									{...(grouped &&
									{
										id: repoId,
									})}
									className="flex h-5 min-w-0 items-center gap-1"
								>
									{grouped && (
										<>
											<span className="block min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap">
												{repoName}
											</span>{" "}
										</>
									)}
									<span className="shrink-0">#{number}</span>
								</span>
								{diff !== null && (
									<span className="-my-0.5 flex shrink-0">
										<ChangesStatButton
											added={diff.added}
											removed={diff.removed}
											statClassName="inline-flex shrink-0 gap-1 text-footnote"
											onOpen={onOpen}
										/>
									</span>
								)}
							</div>
						</div>
					</div>
				</div>
			</ContextMenuTrigger>
			<MenuContent>{items}</MenuContent>
		</ContextMenu>
	);
}
