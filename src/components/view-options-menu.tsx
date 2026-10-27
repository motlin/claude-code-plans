import {EllipsisVertical, FileDiff, Files} from "lucide-react";

import {useIsMac} from "../hooks/use-is-mac";
import {useShortcutKeys} from "../hooks/use-shortcut";
import {bindingsFor} from "../lib/shortcuts/match";
import {bindingToKeys, type ShortcutId} from "../lib/shortcuts/registry";
import {usePaneDefinitions} from "./panes/pane-registry";
import {usePaneHost} from "./panes/pane-host-context";
import {SessionRailMenuItem, SessionRailToggle} from "./session-rail/session-rail-slot";
import {TITLEBAR_ICON_BUTTON_CLASS} from "./titlebar-classes";
import {useTitlebarFolded} from "./titlebar-folded-context";
import {Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";
import {viewOptionsItems} from "./view-options-items";
import type {ViewOptionsFacts, ViewOptionsItem, PaneMenuEntry} from "./view-options-items";

type MainPaneEntry = PaneMenuEntry & {shortcut: ShortcutId};

/** Upstream's trail pane toggles, Changes then Files; each shows once its pane kind is registered. */
const MAIN_PANE_TOGGLES: readonly MainPaneEntry[] = [
	{kind: "changes", label: "Changes", icon: FileDiff, shortcut: "toggle_changes"},
	{kind: "files", label: "Files", icon: Files, shortcut: "toggle_files"},
];

function MainPaneToggle({entry}: {entry: MainPaneEntry}) {
	const host = usePaneHost();
	const keys = useShortcutKeys(entry.shortcut);
	const open = host.isOpen(entry.kind);
	const Icon = entry.icon;
	return (
		<Tooltip content={entry.label} shortcut={keys.keys} side="bottom">
			<button
				type="button"
				aria-label={entry.label}
				aria-pressed={open}
				aria-keyshortcuts={keys.ariaKeyShortcuts}
				onClick={() => {
					host.togglePane(entry.kind);
				}}
				className={TITLEBAR_ICON_BUTTON_CLASS}
			>
				<Icon aria-hidden="true" />
			</button>
		</Tooltip>
	);
}

function ViewOptionsMenu({
	railFolded,
	entries,
	onExpandChat,
}: {
	/** The Show/Hide session rail toggle, folded in from the trail. */
	railFolded: boolean;
	entries: readonly ViewOptionsItem[];
	onExpandChat: (() => void) | undefined;
}) {
	const host = usePaneHost();
	const isMac = useIsMac();
	const expandKeys = useShortcutKeys("expand_collapse_pane");
	return (
		<Menu>
			<Tooltip content="View options" side="bottom">
				<MenuTrigger aria-label="View options" className={TITLEBAR_ICON_BUTTON_CLASS}>
					<EllipsisVertical aria-hidden="true" />
				</MenuTrigger>
			</Tooltip>
			<MenuContent align="end">
				{railFolded && <SessionRailMenuItem />}
				{entries.map((entry) => {
					const binding = entry.shortcut === undefined ? undefined : bindingsFor(entry.shortcut, isMac)[0];
					const Icon = entry.icon;
					return (
						<MenuCheckboxItem
							key={entry.kind}
							checked={host.isOpen(entry.kind)}
							onCheckedChange={() => {
								host.togglePane(entry.kind);
							}}
							{...(binding === undefined ? {} : {shortcut: bindingToKeys(binding)})}
						>
							<span className="flex items-center gap-2">
								<Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
								{entry.label}
								{entry.badge !== undefined && (
									<span
										data-count=""
										className="rounded-full bg-alpha-2 px-1.5 text-caption text-secondary"
									>
										{entry.badge}
									</span>
								)}
							</span>
						</MenuCheckboxItem>
					);
				})}
				{onExpandChat !== undefined && (
					<>
						{(railFolded || entries.length > 0) && <MenuSeparator />}
						<MenuItem onSelect={onExpandChat} shortcut={expandKeys.keys}>
							Expand chat
						</MenuItem>
					</>
				)}
			</MenuContent>
		</Menu>
	);
}

/**
 * The titlebar trail's pane controls, upstream's set and DOM: the session rail
 * toggle and a bare 1x16 separator (the trail's 4px gap each side), then the
 * Changes and Files toggles in their own group, then View options ⋮
 * holding the other panes and Expand chat. Only a chat tile squeezed to 320px
 * or narrower folds the rail, Changes and Files into the top of the menu. The
 * trigger shows only when the menu has items.
 */
export function SessionPaneControls({
	facts,
	railAvailable = false,
	onExpandChat,
}: {
	facts: ViewOptionsFacts;
	/** The session page supplies a rail, so its toggle leads the trail. */
	railAvailable?: boolean;
	/** Hides the header and footer; offered as View options ▸ Expand chat. */
	onExpandChat?: () => void;
}) {
	const host = usePaneHost();
	const definitions = usePaneDefinitions();
	const folded = useTitlebarFolded();
	const registered = new Set(definitions.keys());
	const shown = MAIN_PANE_TOGGLES.filter((entry) => registered.has(entry.kind));
	const otherEntries = viewOptionsItems({registered, isOpen: host.isOpen, facts});
	const menuEntries = folded ? [...shown, ...otherEntries] : otherEntries;
	const railFolded = railAvailable && folded;
	return (
		<>
			{railAvailable && !folded && (
				<>
					<SessionRailToggle />
					<span role="separator" aria-orientation="vertical" className="h-4 w-px shrink-0 bg-border" />
				</>
			)}
			{!folded && (
				<div className="flex items-center gap-1 empty:hidden">
					{shown.map((entry) => (
						<MainPaneToggle key={entry.kind} entry={entry} />
					))}
				</div>
			)}
			{(railFolded || menuEntries.length > 0 || onExpandChat !== undefined) && (
				<ViewOptionsMenu railFolded={railFolded} entries={menuEntries} onExpandChat={onExpandChat} />
			)}
		</>
	);
}
