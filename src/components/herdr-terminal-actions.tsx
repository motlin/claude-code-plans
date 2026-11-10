import {Link} from "@tanstack/react-router";
import {Columns2, Ellipsis, Pencil, Rows2, X} from "lucide-react";
import {type ReactNode, useCallback, useState} from "react";
import {type HerdrTerminalActions, useHerdrTerminalActions} from "../hooks/use-herdr-terminal";
import {useShortcut, useShortcutKeys} from "../hooks/use-shortcut";
import type {HerdrTerminalPaneData, HerdrTerminalWorkspaceData} from "../lib/api/herdr-terminals";
import {closeNeedsConfirmation, siblingPaneId, tabName} from "../lib/herdr/terminal-tab-nav";
import type {ShortcutId} from "../lib/shortcuts/registry";
import {ConfirmDialog} from "./confirm-dialog";
import {GHOST_ICON_BUTTON} from "./panes/terminal-tab-strip";
import {SessionRenameDialog} from "./session-rename-dialog";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "./ui/menu";

type HerdrTerminalTabData = HerdrTerminalWorkspaceData["tabs"][number];

interface PendingClose {
	noun: "pane" | "tab";
	running: HerdrTerminalPaneData;
	close: () => Promise<void>;
}

/**
 * Close a pane or tab, asking first when a pane's process is still running
 * (closing kills it); an idle shell closes at once. `dialog` renders the ask.
 */
function useGuardedClose(): {
	request: (noun: PendingClose["noun"], panes: readonly HerdrTerminalPaneData[], close: () => Promise<void>) => void;
	dialog: ReactNode;
} {
	const [pending, setPending] = useState<PendingClose | null>(null);
	const request = useCallback(
		(noun: PendingClose["noun"], panes: readonly HerdrTerminalPaneData[], close: () => Promise<void>) => {
			const running = panes.find((pane) => pane.process === "running");
			if (!closeNeedsConfirmation(panes) || running === undefined) {
				void close();
				return;
			}
			setPending({noun, running, close});
		},
		[],
	);
	const label = pending?.noun === "tab" ? "Close tab" : "Close pane";
	const command = pending?.running.command ?? null;
	const dialog = (
		<ConfirmDialog
			open={pending !== null}
			onOpenChange={(open) => {
				if (!open) setPending(null);
			}}
			title={`${label}?`}
			body={
				pending === null
					? ""
					: `${pending.running.title} is still running ${command ?? "a command"}. Closing the ${pending.noun} stops it.`
			}
			confirmLabel={label}
			variant="danger"
			onConfirm={() => void pending?.close()}
		/>
	);
	return {request, dialog};
}

/** The rename dialog for one tab, mounted only while open so it starts from the tab's current label. */
function TabRenameDialog({
	tab,
	onClose,
	actions,
}: {
	tab: HerdrTerminalTabData | null;
	onClose: () => void;
	actions: HerdrTerminalActions;
}) {
	if (tab === null) return null;
	return (
		<SessionRenameDialog
			key={tab.tabId}
			open
			title="Rename tab"
			fieldLabel="Tab name"
			initialName={tab.label}
			onClose={onClose}
			onRename={(label) => void actions.renameTab(tab.tabId, label)}
		/>
	);
}

function ActionError({error}: {error: string}) {
	if (error === "") return null;
	return (
		<p role="alert" className="text-caption text-danger-000">
			{error}
		</p>
	);
}

/** The Terminals list's per-pane menu: split right or down (opening the new pane), or close. */
export function PaneActionsMenu({pane}: {pane: HerdrTerminalPaneData}) {
	const actions = useHerdrTerminalActions();
	const guarded = useGuardedClose();
	return (
		<>
			<ActionError error={actions.error} />
			<Menu>
				<MenuTrigger
					aria-label={`Pane actions for ${pane.title}`}
					title="Pane actions"
					className={GHOST_ICON_BUTTON}
				>
					<Ellipsis aria-hidden="true" className="size-4" />
				</MenuTrigger>
				<MenuContent>
					<MenuItem onSelect={() => void actions.split(pane.paneId, "right")}>Split right</MenuItem>
					<MenuItem onSelect={() => void actions.split(pane.paneId, "down")}>Split down</MenuItem>
					<MenuItem
						variant="danger"
						onSelect={() => {
							guarded.request("pane", [pane], async () => actions.closePane(pane.paneId));
						}}
					>
						Close pane
					</MenuItem>
				</MenuContent>
			</Menu>
			{guarded.dialog}
		</>
	);
}

/** The Terminals list's per-tab menu: rename, or close every pane in it. */
export function TabActionsMenu({tab}: {tab: HerdrTerminalTabData}) {
	const actions = useHerdrTerminalActions();
	const guarded = useGuardedClose();
	const [renaming, setRenaming] = useState(false);
	return (
		<>
			<ActionError error={actions.error} />
			<Menu>
				<MenuTrigger
					aria-label={`Tab actions for ${tabName(tab)}`}
					title="Tab actions"
					className={GHOST_ICON_BUTTON}
				>
					<Ellipsis aria-hidden="true" className="size-4" />
				</MenuTrigger>
				<MenuContent>
					<MenuItem
						onSelect={() => {
							setRenaming(true);
						}}
					>
						Rename tab
					</MenuItem>
					<MenuItem
						variant="danger"
						onSelect={() => {
							guarded.request("tab", tab.panes, async () => actions.closeTab(tab.tabId));
						}}
					>
						Close tab
					</MenuItem>
				</MenuContent>
			</Menu>
			{guarded.dialog}
			<TabRenameDialog
				tab={renaming ? tab : null}
				onClose={() => {
					setRenaming(false);
				}}
				actions={actions}
			/>
		</>
	);
}

/** The pane view's links to the other panes of its tab; hidden for a one-pane tab. */
export function PaneSwitcher({tab, paneId}: {tab: HerdrTerminalTabData; paneId: string}) {
	if (tab.panes.length < 2) return null;
	return (
		<nav aria-label={`Panes in ${tabName(tab)}`} className="flex min-w-0 items-center gap-1 overflow-x-auto">
			{tab.panes.map((pane) => {
				const current = pane.paneId === paneId;
				return (
					<Link
						key={pane.paneId}
						to="/terminals/pane/$paneId"
						params={{paneId: pane.paneId}}
						aria-current={current ? "page" : undefined}
						className={`shrink-0 truncate rounded-r5 px-2 py-0.5 text-caption no-underline transition-colors hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${current ? "bg-fill-ghost-hover text-primary" : "text-secondary hover:bg-fill-ghost-hover hover:text-primary"}`}
					>
						{pane.title}
					</Link>
				);
			})}
		</nav>
	);
}

function ToolbarButton({
	label,
	shortcut,
	onClick,
	children,
}: {
	label: string;
	shortcut: ShortcutId;
	onClick: () => void;
	children: ReactNode;
}) {
	const {ariaKeyShortcuts} = useShortcutKeys(shortcut);
	return (
		<button
			type="button"
			aria-label={label}
			aria-keyshortcuts={ariaKeyShortcuts}
			title={label}
			onClick={onClick}
			className={GHOST_ICON_BUTTON}
		>
			{children}
		</button>
	);
}

/**
 * The pane view's management toolbar and its keyboard shortcuts: split right
 * or down (opening the new pane), rename the tab, and close the pane (landing
 * on a neighbor in the tab, else the Terminals list). Shown only while Live
 * terminal input is on; the next/previous pane keys work regardless.
 */
export function PaneTerminalToolbar({
	tab,
	pane,
	writesEnabled,
	onNavigate,
	nextPaneAfterClose,
}: {
	tab: HerdrTerminalTabData | null;
	pane: HerdrTerminalPaneData | null;
	writesEnabled: boolean;
	onNavigate: (paneId: string) => void;
	nextPaneAfterClose: string | null;
}) {
	const actions = useHerdrTerminalActions();
	const guarded = useGuardedClose();
	const [renaming, setRenaming] = useState(false);
	const manageable = writesEnabled && tab !== null && pane !== null;

	const split = (direction: "right" | "down"): void => {
		if (pane !== null) void actions.split(pane.paneId, direction);
	};
	const close = (): void => {
		if (pane !== null) {
			guarded.request("pane", [pane], async () => actions.closePane(pane.paneId, nextPaneAfterClose));
		}
	};
	const step = (direction: 1 | -1): boolean => {
		const target = tab === null || pane === null ? null : siblingPaneId(tab, pane.paneId, direction);
		if (target === null) return false;
		onNavigate(target);
		return true;
	};

	useShortcut(
		"split_terminal_right",
		() => {
			split("right");
		},
		{disabled: !manageable},
	);
	useShortcut(
		"split_terminal_down",
		() => {
			split("down");
		},
		{disabled: !manageable},
	);
	useShortcut("close_terminal_pane", close, {disabled: !manageable});
	useShortcut(
		"rename_terminal_tab",
		() => {
			setRenaming(true);
		},
		{disabled: !manageable},
	);
	useShortcut("next_terminal_pane", () => step(1), {disabled: tab === null});
	useShortcut("prev_terminal_pane", () => step(-1), {disabled: tab === null});

	if (!manageable) return null;
	return (
		<>
			<ActionError error={actions.error} />
			<div role="toolbar" aria-label="Terminal actions" className="flex shrink-0 items-center gap-0.5">
				<ToolbarButton
					label="Split right"
					shortcut="split_terminal_right"
					onClick={() => {
						split("right");
					}}
				>
					<Columns2 aria-hidden="true" className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					label="Split down"
					shortcut="split_terminal_down"
					onClick={() => {
						split("down");
					}}
				>
					<Rows2 aria-hidden="true" className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					label="Rename tab"
					shortcut="rename_terminal_tab"
					onClick={() => {
						setRenaming(true);
					}}
				>
					<Pencil aria-hidden="true" className="size-4" />
				</ToolbarButton>
				<ToolbarButton label="Close pane" shortcut="close_terminal_pane" onClick={close}>
					<X aria-hidden="true" className="size-4" />
				</ToolbarButton>
			</div>
			{guarded.dialog}
			<TabRenameDialog
				tab={renaming ? tab : null}
				onClose={() => {
					setRenaming(false);
				}}
				actions={actions}
			/>
		</>
	);
}
