import {useNavigate} from "@tanstack/react-router";
import {type MouseEvent, type ReactNode, type RefObject, useRef, useState} from "react";
import {setSidebarMenuOpen} from "../../lib/sidebar-menu-open";
import {flushSync} from "react-dom";

import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuGroup, MenuItem, MenuSeparator} from "../ui/menu";
import {BULK_REASONS} from "./group-bulk-items";
import {NewSectionDialog} from "./section-view-menu";
import {useAfterMenuClose} from "./use-after-menu-close";

/** Upstream's whitespace Select all reasons (`K3IOhS`, `q1iA95`). */
const WHITESPACE_SELECT_REASONS =
{
	expandSection: "Expand a section to select its sessions.",
	tooFew: "You need at least 2 sessions that can be selected.",
} as const;

/** The session rows each Select all scope covers, in display order. */
export interface WhitespaceScopes
{
	/** Every session row the list shows. */
	readonly shown: readonly string[];
	/** Every session row the list holds, collapsed sections included. */
	readonly all: readonly string[];
	/** Pinned's shown rows. */
	readonly pinnedShown: readonly string[];
	/** Pinned's rows, as unfolding it would show them. */
	readonly pinnedAll: readonly string[];
}

type InPinned = "open" | "folded" | null;

interface OpenedAt
{
	inPinned: InPinned;
	pinnedToggle: HTMLElement | null;
	/** The list element that had focus when the menu opened. */
	opener: Element | null;
	/** The group toggles before the opener at open, for Collapse all's focus rescue. */
	togglesBeforeOpener: readonly HTMLElement[];
}

const ROW_SELECTOR = "[data-jump-hint-row], [data-row-key]";
const TOGGLE_SELECTOR = "[data-group-toggle]";

function visible(element: Element): boolean
{
	if (!element.isConnected || element.closest("[hidden]") !== null) return false;
	return typeof element.checkVisibility === "function" ? element.checkVisibility() : true;
}

/** Upstream `Yu`: the list's group toggles in one fold state, skipping any under an inert stub. */
function groupToggles(list: HTMLElement | null, expanded: boolean): HTMLElement[]
{
	if (list === null) return [];
	return [...list.querySelectorAll<HTMLElement>(`${TOGGLE_SELECTOR}[aria-expanded="${String(expanded)}"]`)].filter(
		(toggle) => toggle.closest("[inert]:not([data-cds-sheet-inert])") === null,
	);
}

/**
 * Upstream `EH`/`q_`: the context menu on the session list's empty space (gaps between sections, the
 * space under the last row, Pinned's padding): New session ─ New section ─ Select all ─ Collapse all,
 * Expand all. Rows and group headers keep their own menus. Upstream's "New environment" creates a
 * cloud environment, so it has no local item. The trigger is the `display:contents` list root.
 */
export function SidebarWhitespaceMenu({
	scopesRef,
	onSelectOnly,
	children,
	...rootProps
}: {
	/** The latest scopes, read when the menu opens and again after Select all unfolds Pinned. */
	scopesRef: RefObject<WhitespaceScopes>;
	/** Replaces the selection with these rows. */
	onSelectOnly: (ids: readonly string[]) => void;
	children: ReactNode;
	"data-sidebar-selecting"?: string | undefined;
	onClickCapture?: (event: MouseEvent<HTMLDivElement>) => void;
	onDoubleClickCapture?: (event: MouseEvent<HTMLDivElement>) => void;
	onMouseDownCapture?: (event: MouseEvent<HTMLDivElement>) => void;
})
{
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [newSectionOpen, setNewSectionOpen] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const openedAt = useRef<OpenedAt>(
		{
			inPinned: null,
			pinnedToggle: null,
			opener: null,
			togglesBeforeOpener: [],
		},
	);
	// New session and New section take focus, so they act only once the menu has closed.
	const {later, menuProps, contentProps} = useAfterMenuClose();

	// Upstream `x`: a capture-phase look at where the right-click landed, before any menu opens.
	const capture = (event: MouseEvent<HTMLDivElement>) =>
	{
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest(ROW_SELECTOR) !== null) return;
		const pinned = target.closest("[data-pinned-leading], [data-pinned-list]");
		const pinnedToggle =
			pinned?.matches("[data-pinned-list]") === true
				? pinned.querySelector<HTMLElement>(`[data-sidebar-group-label] ${TOGGLE_SELECTOR}`)
				: null;
		const list = listRef.current;
		const active = document.activeElement;
		const opener = active !== null && list?.contains(active) === true ? active : null;
		openedAt.current =
		{
			inPinned:
				pinnedToggle === null
					? null
					: pinnedToggle.getAttribute("aria-expanded") === "false"
						? "folded"
						: "open",
			pinnedToggle,
			opener,
			togglesBeforeOpener:
				opener === null || list === null
					? []
					: [...list.querySelectorAll<HTMLElement>(TOGGLE_SELECTOR)].filter(
							(toggle) =>
								toggle !== opener &&
								(toggle.compareDocumentPosition(opener) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
						),
		};
	};

	return (
		<>
			<ContextMenu
				{...menuProps}
				open={open}
				onOpenChange={(next, details) =>
				{
					// Upstream `$K`: a contextmenu that reached the list through React from a portal opens nothing.
					const target = details.event.target;
					if (next && !(target instanceof Node && listRef.current?.contains(target) === true)) return;
					setOpen(next);
					// Upstream `EH`: the list holds its truncated sections' rows while this menu is open.
					setSidebarMenuOpen(next);
				}}
			>
				<ContextMenuTrigger
					ref={listRef}
					{...rootProps}
					data-kind="code"
					// Upstream `setOverflowMenuOpen`: a peek sidebar stays open while this menu is.
					data-overflow-menu-open={open ? "" : undefined}
					onContextMenuCapture={capture}
					className="df-session-list contents"
				>
					{children}
				</ContextMenuTrigger>
				<MenuContent {...contentProps}>
					<WhitespaceMenuBody
						listRef={listRef}
						openedAtRef={openedAt}
						scopesRef={scopesRef}
						onSelectOnly={onSelectOnly}
						onNewSession={later(
							() =>
								void navigate(
									{
										to: "/",
									},
								).then(requestHomeComposerFocus),
						)}
						onNewSection={later(() =>
						{
							setNewSectionOpen(true);
						})}
					/>
				</MenuContent>
			</ContextMenu>
			<NewSectionDialog open={newSectionOpen} onOpenChange={setNewSectionOpen} />
		</>
	);
}

/** Upstream `q_`: mounts with the menu, so every disabled state is computed once, at open. */
function WhitespaceMenuBody({
	listRef,
	openedAtRef,
	scopesRef,
	onSelectOnly,
	onNewSession,
	onNewSection,
}: {
	listRef: RefObject<HTMLElement | null>;
	openedAtRef: RefObject<OpenedAt>;
	scopesRef: RefObject<WhitespaceScopes>;
	onSelectOnly: (ids: readonly string[]) => void;
	onNewSession: () => void;
	onNewSection: () => void;
})
{
	const [atOpen] = useState(() =>
	{
		const list = listRef.current;
		const {inPinned} = openedAtRef.current;
		const scopes = scopesRef.current;
		const count = (inPinned === "folded" ? scopes.pinnedAll : inPinned ? scopes.pinnedShown : scopes.shown).length;
		const expandFirst = inPinned === null && scopes.all.length >= 2 && groupToggles(list, false).length > 0;
		return {
			selectDisabled: count < 2,
			selectReason: expandFirst ? WHITESPACE_SELECT_REASONS.expandSection : WHITESPACE_SELECT_REASONS.tooFew,
			canCollapse: groupToggles(list, true).some(visible),
			canExpand: groupToggles(list, false).length > 0,
		};
	});

	const selectAll = () =>
	{
		const {inPinned, pinnedToggle} = openedAtRef.current;
		if (inPinned !== null && pinnedToggle?.getAttribute("aria-expanded") === "false")
		{
			flushSync(() =>
			{
				pinnedToggle.click();
			});
		}
		const keys = inPinned === null ? scopesRef.current.shown : scopesRef.current.pinnedAll;
		if (inPinned === null || keys.length > 1) onSelectOnly(keys);
	};

	const fold = (expanded: boolean) => () =>
	{
		for (const toggle of groupToggles(listRef.current, expanded)) toggle.click();
		if (!expanded) return;
		// Upstream's Collapse all focus rescue: a hidden opener hands focus to the last toggle still shown before it.
		const {opener, togglesBeforeOpener} = openedAtRef.current;
		if (opener === null) return;
		requestAnimationFrame(() =>
		{
			if (visible(opener)) return;
			const active = document.activeElement;
			const lost =
				active === null ||
				active === document.body ||
				!active.isConnected ||
				active.closest("[role=menu]") !== null;
			if (!lost) return;
			togglesBeforeOpener.findLast(visible)?.focus();
		});
	};

	const showFold = atOpen.canCollapse || atOpen.canExpand;
	return (
		<>
			<MenuGroup>
				<MenuItem onSelect={onNewSession}>New session</MenuItem>
			</MenuGroup>
			<MenuSeparator />
			<MenuGroup>
				<MenuItem onSelect={onNewSection}>New section</MenuItem>
			</MenuGroup>
			<MenuSeparator />
			<MenuGroup>
				<MenuItem disabled={atOpen.selectDisabled} disabledReason={atOpen.selectReason} onSelect={selectAll}>
					Select all
				</MenuItem>
			</MenuGroup>
			{showFold && (
				<>
					<MenuSeparator />
					<MenuGroup>
						<MenuItem
							disabled={!atOpen.canCollapse}
							disabledReason={BULK_REASONS.collapseAll}
							onSelect={fold(true)}
						>
							Collapse all
						</MenuItem>
						<MenuItem
							disabled={!atOpen.canExpand}
							disabledReason={BULK_REASONS.expandAll}
							onSelect={fold(false)}
						>
							Expand all
						</MenuItem>
					</MenuGroup>
				</>
			)}
		</>
	);
}
