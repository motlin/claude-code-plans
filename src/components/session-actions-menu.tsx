import {requestRevealRow} from "./sidebar/reveal-row-store";
import {useQuery} from "@tanstack/react-query";
import {Ellipsis} from "lucide-react";
import
{
	createContext,
	Fragment,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import {herdrPanesQueryOptions} from "../lib/api/herdr";
import {sessionHasLiveTerminal} from "../lib/terminal-host-capabilities";
import {sessionOpenInQueryOptions, type SessionListItem} from "../lib/api/sessions";
import {useArchiveSessions} from "../hooks/use-session-archive";
import {type SessionRename, useSessionRename} from "../hooks/use-session-rename";
import
{
	getBulkSessionMenuItems,
	getSessionMenuItems,
	type SessionMenuCapability,
	type SessionMenuEntry,
	type SessionMenuItem,
	type SessionMenuItemId,
	type SessionMenuSession,
	sessionMenuReadState,
} from "../lib/session-menu-items";
import {forkDisabledReason} from "../lib/session-fork";
import type {TranscriptMode} from "../lib/transcript-mode";
import {maybeShowDragPinHint} from "../lib/drag-pin-hint";
import {pin, readPinState, unpin, usePins, writePinState} from "../lib/pin-store";
import {assign, createGroup, useSessionGroups} from "../lib/session-group-store";
import {placePin} from "../lib/pinned-sessions";
import {familyKey, toggleFamilyCollapsed, useSidebarState} from "../lib/sidebar-store";
import {hasUnseenWork, markSeen, markUnseen, subscribeUnseenWork} from "../lib/unread-store";
import {setSidebarMenuOpen} from "../lib/sidebar-menu-open";
import {InlineRenameInput} from "./inline-rename-input";
import {NewGroupDialog} from "./new-group-dialog";
import {usePrCardContext} from "./pr-card-context";
import {bulkSelectionFor, type SidebarSelectionApi, useSidebarSelection} from "./sidebar/selection-context";
import {useHasUnseenWork} from "./use-has-unseen-work";
import {useLiveApprovalIds} from "../lib/live-approval-sessions";
import {ackedAt, useAwaitingAckVersion} from "../lib/awaiting-ack-store";
import {isFailedUnacked} from "../lib/failed-row";
import
{
	ContextMenu,
	ContextMenuTrigger,
	Menu,
	MenuContent,
	MenuGroup,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "./ui/menu";
import {ContextMenuArea} from "./context-menu-area";
import {useLazyMenuTrigger} from "./use-lazy-menu-trigger";
import {useSessionMenuRunner} from "./use-session-menu-runner";
import {useRenameAfterMenuClose} from "./use-rename-after-menu-close";
import type {SessionMenuRun} from "./use-session-menu-runner";

/** Actions wired locally so far; the rest appear as their features land. */
export const SESSION_MENU_CAPABILITIES: ReadonlySet<SessionMenuCapability> = new Set<SessionMenuCapability>([
	"openLiveTerminal",
	"openTerminal",
	"openVsCode",
	"openFinder",
	"openClaudeAi",
	"openPr",
	"pin",
	"readState",
	"ackAwaiting",
	"rename",
	"copyLink",
	"fork",
	"customGroups",
	"archive",
]);

interface RowRename
{
	rename: SessionRename;
	/** Opens the inline input once the menu has finished closing. */
	requestRename: () => void;
	/** Opens the New group dialog once the menu has finished closing. */
	requestNewGroup: () => void;
}

const RowRenameContext = createContext<RowRename | null>(null);

function useRowRename(): RowRename
{
	const row = useContext(RowRenameContext);
	if (row === null) throw new Error("Session row titles must render inside SessionActionsMenu");
	return row;
}

/**
 * The row's title text, which the menu's Rename item swaps for an inline
 * input. `render` styles the idle title, e.g. with an overflow fade.
 */
export function SessionRowTitle({render}: {render?: (title: string) => ReactNode}): ReactNode
{
	const {rename} = useRowRename();
	if (rename.editing)
	{
		return (
			<InlineRenameInput
				value={rename.initialValue}
				onCommit={rename.commit}
				onCancel={rename.cancel}
				blurCancels
			/>
		);
	}
	return render === undefined ? rename.title : render(rename.title);
}

export interface TranscriptViewActions
{
	mode: TranscriptMode;
	defaultMode: TranscriptMode;
	setMode: (mode: TranscriptMode) => void;
	makeDefault: (mode: TranscriptMode) => void;
}

/** The sidebar Pinned section's display order, for a row rendered inside it. */
interface PinnedRowContext
{
	pinnedIds: readonly string[];
	/** Called after a Move up / Move down so the row takes focus once the menu closes. */
	onMoved: () => void;
}

/** Upstream's transcript chip menu (`_f`): the row menu less Move to group and Open in ▸ Finder. */
const CHIP_MENU_CAPABILITIES: ReadonlySet<SessionMenuCapability> = new Set(
	[...SESSION_MENU_CAPABILITIES].filter((capability) => capability !== "customGroups" && capability !== "openFinder"),
);

function useSessionMenu(
	session: SessionListItem,
	pinnedRow: PinnedRowContext | undefined,
	familyHead: boolean,
	{requestRename, requestNewGroup}: Pick<RowRename, "requestRename" | "requestNewGroup">,
	capabilities: ReadonlySet<SessionMenuCapability> = SESSION_MENU_CAPABILITIES,
)
{
	const {collapsedFamilies} = useSidebarState();
	const unseen = useHasUnseenWork(session.id);
	const {data: herdr} = useQuery(herdrPanesQueryOptions);
	const {data: openIn} = useQuery(sessionOpenInQueryOptions(session.id));
	const cwd = openIn?.cwd ?? null;
	const bridgeSessionId = openIn?.bridgeSessionId ?? null;
	const pins = usePins();
	const customGroups = useSessionGroups();
	const pinIndex = pinnedRow?.pinnedIds.indexOf(session.id) ?? -1;
	const liveApproval = useLiveApprovalIds().has(session.id);
	useAwaitingAckVersion();

	const menuSession: SessionMenuSession =
	{
		title: session.title,
		pinned: pins.isPinned(session.id),
		readState: sessionMenuReadState(
			session.bucket,
			unseen,
			{
				unseenError: session.unseenError === true,
				archived: session.archived,
			},
		),
		unread: unseen,
		failed: isFailedUnacked(session, ackedAt(session.id)),
		archived: session.archived,
		prUrl: session.pr?.url ?? null,
		hasLiveTerminal: sessionHasLiveTerminal(herdr?.panes, session.id),
		forkDisabledReason: forkDisabledReason(
			{
				working: session.bucket === "working",
				cwd,
			},
		),
		cwd,
		bridgeSessionId,
		customGroup:
		{
			groups: customGroups.groups,
			current: customGroups.groupOf(session.id),
		},
		liveApproval,
	};
	if (familyHead)
	{
		menuSession.nestedSessions =
		{
			hidden: collapsedFamilies.includes(familyKey(session.id)),
		};
	}
	if (pinnedRow !== undefined && pinIndex !== -1)
	{
		menuSession.pinPosition =
		{
			index: pinIndex,
			count: pinnedRow.pinnedIds.length,
		};
	}

	const run = useSessionMenuRunner(
		{
			sessionId: session.id,
			mtime: session.mtime,
			failedAt: session.failedAt,
			cwd,
			bridgeSessionId,
			prUrl: session.pr?.url ?? null,
			requestRename,
			requestNewGroup,
			toggleNested: () =>
			{
				toggleFamilyCollapsed(session.id);
			},
			setPinned: (pinned) =>
			{
				if (!pinned)
				{
					unpin(session.id);
					return;
				}
				pin(session.id);
				maybeShowDragPinHint();
			},
			movePinned: (delta) =>
			{
				if (pinnedRow === undefined || pinIndex === -1) return;
				writePinState(placePin(readPinState(), pinnedRow.pinnedIds, session.id, pinIndex + delta));
				// Upstream `Sy(e), a$(e)`: a row moved past Pinned's page is revealed and focused.
				requestRevealRow(
					session.id,
					{
						focus: true,
					},
				);
				pinnedRow.onMoved();
			},
		},
	);

	return {
		entries: getSessionMenuItems(
			menuSession,
			capabilities,
			{
				surface: "row",
			},
		),
		run,
	};
}

/** Upstream's test hooks on the Move to group trigger and its New group… item. */
const MENU_TEST_IDS: Partial<Record<SessionMenuItemId, string>> =
{
	"move-to-group": "move-to-group-trigger",
	"new-group": "new-custom-group",
};

function testIdProps(id: SessionMenuItemId)
{
	const testId = MENU_TEST_IDS[id];
	return testId === undefined
		? {}
		:
			{
				"data-testid": testId,
			};
}

/** Radio value: a Move to group entry's group, a transcript mode, an output style, or the Ungrouped item's id. */
function radioValue(entry: SessionMenuItem): string
{
	return entry.groupId ?? entry.transcriptMode ?? entry.outputStyle ?? entry.id;
}

export function MenuEntries({entries, run}: {entries: SessionMenuEntry[]; run: SessionMenuRun})
{
	const radios = entries.filter(
		(entry): entry is SessionMenuItem => entry.kind === "item" && entry.checked !== undefined,
	);
	if (radios.length > 0)
	{
		const current = radios.find((entry) => entry.checked);
		return (
			<MenuRadioGroup value={current === undefined ? null : radioValue(current)}>
				<MenuEntryList entries={entries} run={run} />
			</MenuRadioGroup>
		);
	}
	return splitSections(entries).map((section, index) => (
		<Fragment key={`section-${index}`}>
			{index > 0 && <MenuSeparator />}
			<MenuGroup>
				<MenuEntryList entries={section} run={run} />
			</MenuGroup>
		</Fragment>
	));
}

/** The runs of entries between separators, with empty runs dropped. */
function splitSections(entries: SessionMenuEntry[]): SessionMenuEntry[][]
{
	const sections: SessionMenuEntry[][] = [[]];
	for (const entry of entries)
	{
		if (entry.kind === "separator") sections.push([]);
		else sections.at(-1)?.push(entry);
	}
	return sections.filter((section) => section.length > 0);
}

function MenuEntryList({entries, run}: {entries: SessionMenuEntry[]; run: SessionMenuRun})
{
	return entries.map((entry, index) =>
	{
		if (entry.kind === "separator") return <MenuSeparator key={`separator-${index}`} />;
		if (entry.submenu !== undefined)
		{
			return (
				<MenuSub key={entry.id}>
					<MenuSubTrigger {...testIdProps(entry.id)}>{entry.label}</MenuSubTrigger>
					<MenuSubContent>
						<MenuEntries entries={entry.submenu} run={run} />
					</MenuSubContent>
				</MenuSub>
			);
		}
		if (entry.checked !== undefined)
		{
			return (
				<MenuRadioItem
					key={radioValue(entry)}
					value={radioValue(entry)}
					closeOnClick
					{...(entry.accelerator === undefined
						? {}
						:
							{
								accelerator: entry.accelerator,
							})}
					onClick={() =>
					{
						// Upstream's output-style `select` is a no-op for the checked style.
						if (entry.outputStyle !== undefined && entry.checked) return;
						run(entry.id, entry.groupId ?? entry.transcriptMode ?? entry.outputStyle);
					}}
				>
					{entry.label}
				</MenuRadioItem>
			);
		}
		return (
			<MenuItem
				key={entry.id}
				{...testIdProps(entry.id)}
				{...(entry.accelerator === undefined
					? {}
					:
						{
							accelerator: entry.accelerator,
						})}
				{...(entry.disabled
					?
						{
							disabled: true,
						}
					: {})}
				{...(entry.disabledReason === undefined
					? {}
					:
						{
							disabledReason: entry.disabledReason,
						})}
				onSelect={() =>
				{
					run(entry.id);
				}}
			>
				{entry.label}
			</MenuItem>
		);
	});
}

/** Mounted only while a menu is open, so closed rows never query or subscribe. */
function SessionMenuBody({
	session,
	pinnedRow,
	familyHead,
}: {
	session: SessionListItem;
	pinnedRow: PinnedRowContext | undefined;
	familyHead: boolean;
})
{
	const {entries, run} = useSessionMenu(session, pinnedRow, familyHead, useRowRename());
	return <MenuEntries entries={entries} run={run} />;
}

/** A transcript session chip's right-click menu items; Rename calls `requestRename` (upstream's rename dialog). */
export function SessionChipMenuBody({session, requestRename}: {session: SessionListItem; requestRename: () => void})
{
	const {entries, run} = useSessionMenu(
		session,
		undefined,
		false,
		{
			requestRename,
			requestNewGroup: () => undefined,
		},
		CHIP_MENU_CAPABILITIES,
	);
	return <MenuEntries entries={entries} run={run} />;
}

/** Opens the New group dialog, which then moves `ids` into the new group. */
type RequestBulkNewGroup = (ids: readonly string[]) => void;

/** True while every one of `ids` is unread. */
function useAllUnseen(ids: readonly string[]): boolean
{
	const key = ids.join("\n");
	const getSnapshot = useCallback(() => key.split("\n").every((id) => hasUnseenWork(id)), [key]);
	return useSyncExternalStore(subscribeUnseenWork, getSnapshot, () => false);
}

/**
 * The multi-select row menu: Mark as unread (or read), Move {count} to group ▸ and
 * Archive, each applied to every selected row. Mounted only while the menu is open.
 */
function BulkMenuBody({
	ids,
	selection,
	requestNewGroup,
}: {
	ids: readonly string[];
	selection: SidebarSelectionApi;
	requestNewGroup: RequestBulkNewGroup;
})
{
	const allUnread = useAllUnseen(ids);
	const customGroups = useSessionGroups();
	const archiveSessions = useArchiveSessions();
	const sessions = ids.flatMap((id) =>
	{
		const session = selection.sessions.get(id);
		return session === undefined ? [] : [session];
	});
	const groupIds = ids.map((id) => customGroups.groupOf(id));
	const [firstGroup = null] = groupIds;
	const entries = getBulkSessionMenuItems(
		{
			count: ids.length,
			allUnread,
			anyUnarchived: sessions.some((session) => !session.archived),
			customGroup:
			{
				groups: customGroups.groups,
				current: groupIds.every((id) => id === firstGroup) ? firstGroup : null,
				anyGrouped: groupIds.some((id) => id !== null),
			},
		},
	);
	const run: SessionMenuRun = (id, value) =>
	{
		switch (id)
		{
			case "mark-read":
				for (const sessionId of ids) markSeen(sessionId);
				break;
			case "mark-unread":
				for (const sessionId of ids)
					markUnseen(
						sessionId,
						{
							explicit: true,
						},
					);
				break;
			case "archive":
				void archiveSessions(sessions.filter((session) => !session.archived).map(({id}) => id));
				break;
			case "move-to-custom-group":
				if (value === undefined) return;
				for (const sessionId of ids) assign(sessionId, value);
				break;
			case "ungroup":
				for (const sessionId of ids) assign(sessionId, null);
				break;
			case "new-group":
				requestNewGroup(ids);
				break;
			default:
				return;
		}
		selection.clear();
	};
	return <MenuEntries entries={entries} run={run} />;
}

/**
 * The row menu's items: the bulk menu when the row is part of a multi-row selection,
 * else the row's own. The choice is fixed when the menu opens (this mounts then),
 * so clearing the selection on a bulk action doesn't swap items in the closing menu.
 */
function RowMenuBody({
	session,
	pinnedRow,
	familyHead,
	requestBulkNewGroup,
}: {
	session: SessionListItem;
	pinnedRow: PinnedRowContext | undefined;
	familyHead: boolean;
	requestBulkNewGroup: RequestBulkNewGroup;
})
{
	const selection = useSidebarSelection();
	const [bulkIds] = useState(() => bulkSelectionFor(selection, session.id));
	if (bulkIds !== null && selection !== null)
	{
		return <BulkMenuBody ids={bulkIds} selection={selection} requestNewGroup={requestBulkNewGroup} />;
	}
	return <SessionMenuBody session={session} pinnedRow={pinnedRow} familyHead={familyHead} />;
}

/**
 * Upstream `AG`: a row's menu, context menu or dialog holds the sidebar's `overflowMenuOpen` while open, and
 * releases it when it closes or the row unmounts with it open.
 */
function useSidebarMenuOpenWhile(open: boolean): void
{
	const reported = useRef(false);
	useEffect(() =>
	{
		if (open === reported.current) return;
		reported.current = open;
		setSidebarMenuOpen(open);
	}, [open]);
	useEffect(
		() => () =>
		{
			if (reported.current) setSidebarMenuOpen(false);
		},
		[],
	);
}

const KEBAB_CLASS =
	"df-touch-reveal absolute top-1/2 right-[var(--sb-row-ctl-inset)] flex size-[var(--sb-row-ctl,24px)] -translate-y-1/2 items-center justify-center rounded-r5 text-secondary hover:text-primary aria-expanded:text-primary opacity-0 focus-visible:opacity-100 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus group-hover/session-row:opacity-100 group-has-[:focus-visible]/session-row:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-fill-ghost-hover";

/**
 * claude.ai/code's session row actions: a 24px hover kebab ("More options for
 * <title>") opening an end-aligned dropdown, and right-click anywhere on the
 * row opening the same items at the pointer.
 */
export function SessionActionsMenu({
	session,
	pinnedIds,
	children,
	className,
	kebabTabIndex,
	wrapKebab,
	touchMenu = false,
	described = false,
	familyHead = false,
}: {
	session: SessionListItem;
	/** The sidebar Pinned section's display order, when this row is rendered inside it. */
	pinnedIds?: readonly string[];
	/** -1 inside a roving-focus list, whose Menu key and Shift+F10 open the kebab instead. */
	kebabTabIndex?: number;
	/** Upstream's `coveredCell`: wraps the kebab, e.g. in a PR row's keyboard-only Pull requests card. */
	wrapKebab?: (kebab: ReactElement) => ReactNode;
	/** Keep the kebab visible at rest on touch, as upstream does only on the current session's row. */
	touchMenu?: boolean;
	/** The row is two-line (Show ▸ Metadata): CSS centres the kebab and decoration on its title line. */
	described?: boolean;
	/** A sidebar fork-family head (upstream `treePlace "head"`): the menu offers Hide/Show nested sessions. */
	familyHead?: boolean;
	children: ReactNode;
	className?: string;
})
{
	const rename = useSessionRename(session.id, session.title, session.titleIsStandIn === true);
	const renameAfterClose = useRenameAfterMenuClose(rename.startEditing);
	const {requestRename} = renameAfterClose;
	const [newGroupOpen, setNewGroupOpen] = useState(false);
	const [newGroupMounted, setNewGroupMounted] = useState(false);
	const newGroupAfterClose = useRenameAfterMenuClose(() =>
	{
		setNewGroupMounted(true);
		setNewGroupOpen(true);
	});
	// The rows a bulk New group… moves, captured when the menu asked for the dialog.
	const newGroupIds = useRef<readonly string[] | null>(null);
	const requestBulkNewGroup: RequestBulkNewGroup = (ids) =>
	{
		newGroupIds.current = ids;
		newGroupAfterClose.requestRename();
	};
	const createGroupWithRow = (name: string) =>
	{
		const groupId = createGroup(name).id;
		const ids = newGroupIds.current ?? [session.id];
		newGroupIds.current = null;
		for (const id of ids) assign(id, groupId);
	};
	const rowRef = useRef<HTMLDivElement>(null);
	// Upstream's `data-menu-open` / `data-context-menu-open` keep the row's hover background while a menu is open.
	const [menuOpen, setMenuOpen] = useState(false);
	const [contextMenuOpen, setContextMenuOpen] = useState(false);
	useSidebarMenuOpenWhile(menuOpen || contextMenuOpen || newGroupOpen);
	// Upstream's `kI.menuOpen`: an open row menu holds the row's session and PR cards shut.
	const {onMenuOpenChange} = usePrCardContext();
	const rowMenuOpen = menuOpen || contextMenuOpen;
	useEffect(() =>
	{
		onMenuOpenChange(rowMenuOpen);
	}, [rowMenuOpen, onMenuOpenChange]);
	// After Move up / Move down the row itself takes focus, like upstream's movePinned.
	const focusRowAfterClose = useRef(false);
	const onOpenChangeComplete = (open: boolean) =>
	{
		renameAfterClose.onOpenChangeComplete(open);
		newGroupAfterClose.onOpenChangeComplete(open);

		if (open || !focusRowAfterClose.current) return;
		focusRowAfterClose.current = false;
		rowRef.current?.querySelector<HTMLElement>("[data-row-main-button]")?.focus();
	};
	const finalFocus = () =>
		renameAfterClose.finalFocus() && newGroupAfterClose.finalFocus() && !focusRowAfterClose.current;
	const pinnedRow: PinnedRowContext | undefined =
		pinnedIds === undefined
			? undefined
			:
				{
					pinnedIds,
					onMoved: () =>
					{
						focusRowAfterClose.current = true;
					},
				};
	const requestNewGroup = newGroupAfterClose.requestRename;
	const rowRename = useMemo(
		() => (
		{
			rename,
			requestRename,
			requestNewGroup: () =>
			{
				newGroupIds.current = null;
				requestNewGroup();
			},
		}),
		[rename, requestRename, requestNewGroup],
	);
	const menuBody = (
		<RowMenuBody
			session={session}
			pinnedRow={pinnedRow}
			familyHead={familyHead}
			requestBulkNewGroup={requestBulkNewGroup}
		/>
	);
	// Each menu mounts its root on first use; a closed row carries neither.
	const lazyKebab = useLazyMenuTrigger<HTMLButtonElement>();
	const [contextMenuMounted, setContextMenuMounted] = useState(false);
	const contextTriggerRef = useRef<HTMLDivElement>(null);
	const kebabProps =
	{
		"aria-label": `More options for ${rename.title}`,
		"data-row-action": "",
		...(kebabTabIndex === undefined
			? {}
			:
				{
					tabIndex: kebabTabIndex,
				}),
		className: KEBAB_CLASS,
	};
	const kebabIcon = <Ellipsis aria-hidden="true" className="size-4" />;
	const kebab = lazyKebab.mounted ? (
		<MenuTrigger ref={lazyKebab.triggerRef} {...kebabProps}>
			{kebabIcon}
		</MenuTrigger>
	) : (
		// Base UI's closed trigger markup, less its generated id.
		<button
			type="button"
			aria-haspopup="menu"
			aria-expanded="false"
			{...kebabProps}
			{...lazyKebab.placeholderProps}
		>
			{kebabIcon}
		</button>
	);
	const wrappedKebab = wrapKebab === undefined ? kebab : wrapKebab(kebab);
	return (
		<RowRenameContext.Provider value={rowRename}>
			<div
				ref={rowRef}
				data-row=""
				data-session-actions=""
				data-touch-menu={touchMenu ? "" : undefined}
				data-described={described ? "" : undefined}
				data-menu-open={menuOpen ? "true" : undefined}
				data-context-menu-open={contextMenuOpen ? "true" : undefined}
				className={`group/session-row relative ${className ?? ""}`}
			>
				<ContextMenuArea
					mounted={contextMenuMounted}
					onFirstUse={() =>
					{
						setContextMenuMounted(true);
					}}
					triggerRef={contextTriggerRef}
				>
					{children}
				</ContextMenuArea>
				{contextMenuMounted && (
					<ContextMenu onOpenChange={setContextMenuOpen} onOpenChangeComplete={onOpenChangeComplete}>
						<ContextMenuTrigger ref={contextTriggerRef} hidden data-row-context-trigger="" />
						<MenuContent density="comfortable" finalFocus={finalFocus}>
							{menuBody}
						</MenuContent>
					</ContextMenu>
				)}
				{lazyKebab.mounted ? (
					<Menu onOpenChange={setMenuOpen} onOpenChangeComplete={onOpenChangeComplete}>
						{wrappedKebab}
						<MenuContent density="comfortable" align="end" finalFocus={finalFocus}>
							{menuBody}
						</MenuContent>
					</Menu>
				) : (
					wrappedKebab
				)}
			</div>
			{newGroupMounted && (
				<NewGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} onCreate={createGroupWithRow} />
			)}
		</RowRenameContext.Provider>
	);
}
