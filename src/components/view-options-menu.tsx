import {useState, type RefObject} from "react";

import {useIsMac} from "../hooks/use-is-mac";
import {useShortcutKeys} from "../hooks/use-shortcut";
import {ICON_GLYPHS} from "../lib/icon-glyphs";
import {bindingsFor} from "../lib/shortcuts/match";
import {bindingToKeys, type ShortcutId} from "../lib/shortcuts/registry";
import {foldBudget, splitPanes} from "../lib/titlebar-fold";
import {usePaneDefinitions} from "./panes/pane-registry";
import {usePaneHost} from "./panes/pane-host-context";
import {SessionRailMenuItem, SessionRailToggle} from "./session-rail/session-rail-slot";
import {TITLEBAR_ICON_BUTTON_CLASS} from "./titlebar-classes";
import {useTitlebarHiddenCount} from "./titlebar-fold-context";
import {useEmptiedFocus, useFoldFocus} from "./use-fold-focus";
import {TITLEBAR_TOGGLES_ATTRIBUTE} from "./use-titlebar-fold";
import {Icon} from "./ui/icon";
import {Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "./ui/menu";
import {Tooltip} from "./ui/tooltip";
import {viewOptionsHasRows, viewOptionsItems} from "./view-options-items";
import type {ViewOptionsFacts, ViewOptionsItem, PaneMenuEntry} from "./view-options-items";

type MainPaneEntry = PaneMenuEntry &
{
	glyph: "ChangesPlusMinus" | "Files";
	shortcut: ShortcutId;
};

/** Upstream's trail pane toggles, Changes then Files; each shows once its pane kind is registered. */
const MAIN_PANE_TOGGLES: readonly MainPaneEntry[] = [
	{
		kind: "changes",
		label: "Changes",
		glyph: "ChangesPlusMinus",
		icon: ICON_GLYPHS.ChangesPlusMinus,
		shortcut: "toggle_changes",
	},
	{
		kind: "files",
		label: "Files",
		glyph: "Files",
		icon: ICON_GLYPHS.Files,
		shortcut: "toggle_files",
	},
];

function MainPaneToggle({entry}: {entry: MainPaneEntry})
{
	const host = usePaneHost();
	const keys = useShortcutKeys(entry.shortcut);
	const open = host.isOpen(entry.kind);
	return (
		<Tooltip content={entry.label} shortcut={keys.keys} side="bottom">
			<button
				type="button"
				aria-label={entry.label}
				aria-pressed={open}
				aria-keyshortcuts={keys.ariaKeyShortcuts}
				onClick={() =>
				{
					host.togglePane(entry.kind);
				}}
				className={TITLEBAR_ICON_BUTTON_CLASS}
			>
				<Icon name={entry.glyph} size="auto" />
			</button>
		</Tooltip>
	);
}

function ViewOptionsMenu({
	open,
	onOpenChange,
	triggerFocusProps,
	triggerRef,
	railFolded,
	entries,
	onExpandChat,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	triggerFocusProps: ReturnType<typeof useEmptiedFocus>;
	triggerRef: RefObject<HTMLButtonElement | null>;
	/** The Show/Hide session rail toggle, folded in from the trail. */
	railFolded: boolean;
	entries: readonly ViewOptionsItem[];
	onExpandChat: (() => void) | undefined;
})
{
	const host = usePaneHost();
	const isMac = useIsMac();
	const expandKeys = useShortcutKeys("expand_collapse_pane");
	return (
		<Menu open={open} onOpenChange={onOpenChange}>
			<Tooltip content="View options" side="bottom">
				<MenuTrigger
					ref={triggerRef}
					{...triggerFocusProps}
					aria-label="View options"
					className={TITLEBAR_ICON_BUTTON_CLASS}
				>
					<Icon name="DotsHorizontal" size="auto" />
				</MenuTrigger>
			</Tooltip>
			<MenuContent align="end" sideOffset={6}>
				{railFolded && <SessionRailMenuItem />}
				{entries.map((entry) =>
				{
					const binding = entry.shortcut === undefined ? undefined : bindingsFor(entry.shortcut, isMac)[0];
					const Glyph = entry.icon;
					return (
						<MenuCheckboxItem
							key={entry.kind}
							closeOnClick
							checked={host.isOpen(entry.kind)}
							onCheckedChange={() =>
							{
								host.togglePane(entry.kind);
							}}
							{...(binding === undefined
								? {}
								:
									{
										shortcut: bindingToKeys(binding),
									})}
							{...(entry.badge === undefined
								? {}
								:
									{
										count: entry.badge,
									})}
							icon={<Glyph aria-hidden="true" className="size-4 shrink-0 text-primary" />}
						>
							{entry.label}
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
 * toggle, then the Changes and Files toggles in their own group, then View
 * options ⋯ holding the other panes and Expand chat. The titlebar's measured
 * fold hides buttons into the top of the menu one at a time: the inactive
 * panes, then the open one, then the rail. The trigger shows when a pane row
 * other than an available-only Plan, a folded toggle, the folded rail, or
 * Expand chat is present; when it disappears, focus that fell to the body
 * moves to the last inline toggle.
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
})
{
	const host = usePaneHost();
	const definitions = usePaneDefinitions();
	const {railToggleFolded, hiddenMainPanes} = foldBudget(
		{
			railToggleFoldable: railAvailable,
			hiddenCount: useTitlebarHiddenCount(),
		},
	);
	const registered = new Set(definitions.keys());
	const shown = MAIN_PANE_TOGGLES.filter((entry) => registered.has(entry.kind)).map((entry) => (
	{
		...entry,
		active: host.isOpen(entry.kind),
	}));
	const {folded, inline} = splitPanes(shown, hiddenMainPanes);
	const {togglesRef, triggerRef, railFocusProps, togglesFocusProps} = useFoldFocus();
	const viewItems = viewOptionsItems(
		{
			registered,
			isOpen: host.isOpen,
			facts,
		},
	);
	const menuEntries = [...folded, ...viewItems];
	const triggerShown =
		railToggleFolded ||
		viewOptionsHasRows(
			{
				folded,
				items: viewItems,
				isOpen: host.isOpen,
			},
		) ||
		onExpandChat !== undefined;
	const [menuOpen, setMenuOpen] = useState(false);
	const open = triggerShown && menuOpen;
	const triggerFocusProps = useEmptiedFocus(
		{
			shown: triggerShown,
			open,
			triggerRef,
			togglesRef,
		},
	);
	return (
		<>
			{railAvailable && !railToggleFolded && <SessionRailToggle {...railFocusProps} />}
			<div
				ref={togglesRef}
				{...
				{
					[TITLEBAR_TOGGLES_ATTRIBUTE]: "",
				}}
				{...togglesFocusProps}
				className="flex items-center gap-1 empty:hidden"
			>
				{inline.map((entry) => (
					<MainPaneToggle key={entry.kind} entry={entry} />
				))}
			</div>
			{triggerShown && (
				<ViewOptionsMenu
					open={open}
					onOpenChange={setMenuOpen}
					triggerFocusProps={triggerFocusProps}
					triggerRef={triggerRef}
					railFolded={railToggleFolded}
					entries={menuEntries}
					onExpandChat={onExpandChat}
				/>
			)}
		</>
	);
}
