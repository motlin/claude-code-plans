import {
	AppWindow,
	EllipsisVertical,
	FileDiff,
	Files,
	GitFork,
	Info,
	Link2,
	ListChecks,
	ListTodo,
	type LucideIcon,
	SquareTerminal,
} from "lucide-react";

import {useIsMac} from "../hooks/use-is-mac";
import {useShortcutKeys} from "../hooks/use-shortcut";
import type {PaneKind} from "../lib/pane-layout";
import {bindingsFor} from "../lib/shortcuts/match";
import {bindingToKeys, type ShortcutId} from "../lib/shortcuts/registry";
import {usePaneDefinitions} from "./panes/pane-registry";
import {usePaneHost} from "./panes/tile-host";
import {TITLEBAR_ICON_BUTTON_CLASS} from "./titlebar-classes";
import {useTitlebarWidth} from "./titlebar-width";
import {Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";

export interface PaneMenuEntry {
	kind: PaneKind;
	label: string;
	icon: LucideIcon;
	shortcut?: ShortcutId;
}

type MainPaneEntry = PaneMenuEntry & {shortcut: ShortcutId};

/** Upstream's one trail pane toggle; it shows once its pane kind is registered. */
const MAIN_PANE_TOGGLES: readonly MainPaneEntry[] = [
	{kind: "changes", label: "Changes", icon: FileDiff, shortcut: "toggle_changes"},
];

/** What the session offers, deciding which View options items apply. */
export interface ViewOptionsFacts {
	artifactCount?: number;
	/** The session is linked to a plan file through `plan_sessions`. */
	hasPlan?: boolean;
	backgroundTasks?: {total: number; running: number};
	subagentCount?: number;
}

export interface ViewOptionsItem extends PaneMenuEntry {
	/** Running-count badge (Background tasks). */
	badge?: number;
}

interface ViewOptionsCandidate extends ViewOptionsItem {
	applies: boolean;
}

function candidates(facts: ViewOptionsFacts): ViewOptionsCandidate[] {
	const running = facts.backgroundTasks?.running ?? 0;
	return [
		{kind: "terminal", label: "Terminal", icon: SquareTerminal, shortcut: "toggle_terminal", applies: true},
		{
			kind: "artifacts",
			label: "Artifacts",
			icon: AppWindow,
			applies: (facts.artifactCount ?? 0) > 0,
		},
		{kind: "files", label: "Files", icon: Files, shortcut: "toggle_files", applies: true},
		{kind: "links", label: "Links", icon: Link2, applies: true},
		{
			kind: "background-tasks",
			label: "Background tasks",
			icon: ListChecks,
			applies: (facts.backgroundTasks?.total ?? 0) > 0,
			...(running > 0 ? {badge: running} : {}),
		},
		{kind: "plan", label: "Plan", icon: ListTodo, applies: facts.hasPlan === true},
		{
			kind: "subagents",
			label: "Subagents",
			icon: GitFork,
			applies: (facts.subagentCount ?? 0) > 0,
		},
		{kind: "session-details", label: "Session details", icon: Info, applies: true},
	];
}

/**
 * The View options items after any folded toggles: a registered pane shows
 * when it applies to the session or is already open, like upstream.
 */
export function viewOptionsItems({
	registered,
	isOpen,
	facts,
}: {
	registered: ReadonlySet<PaneKind>;
	isOpen: (kind: PaneKind) => boolean;
	facts: ViewOptionsFacts;
}): ViewOptionsItem[] {
	return candidates(facts)
		.filter((item) => registered.has(item.kind) && (item.applies || isOpen(item.kind)))
		.map(({applies: _applies, ...item}) => item);
}

/** Titlebar lead kept clear of the trail: title, chevron and a pill or two. */
const LEAD_RESERVE_PX = 240;
/** The trail's `pl-6`. */
const TRAIL_PADDING_PX = 24;
const CONTROL_PX = 26;
const GAP_PX = 4;

/**
 * How many of the trailing main toggles fold into View options: whatever does
 * not fit beside the lead reserve and the menu trigger.
 */
export function hiddenToggleCount({titlebarWidth, count}: {titlebarWidth: number | null; count: number}): number {
	if (titlebarWidth === null) return 0;
	const room = titlebarWidth - LEAD_RESERVE_PX - TRAIL_PADDING_PX - (CONTROL_PX + GAP_PX);
	const shown = Math.max(0, Math.floor(room / (CONTROL_PX + GAP_PX)));
	return Math.max(0, count - shown);
}

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
				onClick={() => host.togglePane(entry.kind)}
				className={TITLEBAR_ICON_BUTTON_CLASS}
			>
				<Icon aria-hidden="true" />
			</button>
		</Tooltip>
	);
}

function ViewOptionsMenu({
	entries,
	onExpandChat,
}: {
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
				{entries.map((entry) => {
					const binding = entry.shortcut === undefined ? undefined : bindingsFor(entry.shortcut, isMac)[0];
					const Icon = entry.icon;
					return (
						<MenuCheckboxItem
							key={entry.kind}
							checked={host.isOpen(entry.kind)}
							onCheckedChange={() => host.togglePane(entry.kind)}
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
						{entries.length > 0 && <MenuSeparator />}
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
 * The titlebar trail's pane controls, upstream's set: the Changes toggle, then
 * View options ⋮ holding the other panes (Terminal, Files, …) and Expand chat.
 * When the titlebar is too narrow Changes folds into the top of the menu; the
 * trigger shows only when the menu has items.
 */
export function SessionPaneControls({
	facts,
	onExpandChat,
}: {
	facts: ViewOptionsFacts;
	/** Hides the header and footer; offered as View options ▸ Expand chat. */
	onExpandChat?: () => void;
}) {
	const host = usePaneHost();
	const definitions = usePaneDefinitions();
	const titlebarWidth = useTitlebarWidth();
	const registered = new Set(definitions.keys());
	const toggles = MAIN_PANE_TOGGLES.filter((entry) => registered.has(entry.kind));
	const hidden = hiddenToggleCount({titlebarWidth, count: toggles.length});
	const shown = toggles.slice(0, toggles.length - hidden);
	const menuEntries = [
		...toggles.slice(toggles.length - hidden),
		...viewOptionsItems({registered, isOpen: host.isOpen, facts}),
	];
	return (
		<>
			{shown.map((entry) => (
				<MainPaneToggle key={entry.kind} entry={entry} />
			))}
			{(menuEntries.length > 0 || onExpandChat !== undefined) && (
				<ViewOptionsMenu entries={menuEntries} onExpandChat={onExpandChat} />
			)}
		</>
	);
}
