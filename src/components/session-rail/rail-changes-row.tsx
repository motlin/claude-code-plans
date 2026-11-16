import {Diff, Ellipsis} from "lucide-react";
import {type KeyboardEvent, useId} from "react";

import {useShortcutKeys} from "../../hooks/use-shortcut";
import {AnimatedDiffStat} from "../diff-stat";
import {cdsButtonClass} from "../ui/cds-button";
import {ContextMenu, ContextMenuTrigger, Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import {Tooltip} from "../ui/tooltip";

/*
 * Upstream's flat-rail Changes row (`gr` row form, `div[data-rail-changes-row]`): the plus-minus glyph, an
 * optional repo label, a ghost xxs stat button that opens the Changes pane, a spacer, and an sr-only "…" menu
 * that also opens on right-click. Upstream draws a stacked form instead in a non-flat rail; this account's live
 * rail is flat, so the docked rail draws the row form too.
 */

/** Upstream `k`. */
const ROW_CLASS = "flex min-h-6.5 w-full min-w-0 items-center gap-sm px-xs text-body";
/** Upstream `W`: the 20px glyph slot at the rail icon size. */
const GLYPH_CLASS = "flex size-5 shrink-0 items-center justify-center text-secondary [&_svg]:size-4";
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
	const {keys, ariaKeyShortcuts} = useShortcutKeys("toggle_changes");
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
					<span className={GLYPH_CLASS}>
						<Diff aria-hidden />
					</span>
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
							<AnimatedDiffStat
								added={added}
								removed={removed}
								className="inline-flex shrink-0 gap-1 text-body"
							/>
						</button>
					</Tooltip>
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
