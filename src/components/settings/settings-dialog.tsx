import {Dialog} from "@base-ui/react/dialog";
import {useLocation, useNavigate} from "@tanstack/react-router";
import {X} from "lucide-react";
import {type ComponentProps, Suspense, use, useCallback, useEffect, useRef, useState, type ComponentType} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import {customizeSectionLabels, settingsTabLabels} from "../../lib/schema-choices";
import {
	type CustomizeSection,
	CustomizeSectionSchema,
	customizeHash,
	parseCustomizeHash,
	parseSettingsHash,
	settingsHash,
	SettingsTabSchema,
	type SettingsTab,
} from "../../lib/settings-hash";
import {
	AiFeaturesSettings,
	ApplicationConfigurationSection,
	ClaudeCodeSettings,
	ClaudeConfigSettings,
	GeneralSettings,
	SessionsSettings,
	SetupSettings,
	TranscriptSettings,
} from "./settings-sections";
import {SettingsFlashContext, type SettingsFlash} from "./settings-row";
import {SettingsSearch} from "./settings-search";
import {CUSTOMIZE_SECTION_ICONS, SETTINGS_TAB_ICONS} from "./settings-tab-icons";
import {UsageSettings} from "./usage-settings";

const TAB_PANELS = {
	general: GeneralSettings,
	usage: UsageSettings,
	"claude-code": ClaudeCodeSettings,
	transcript: TranscriptSettings,
	sessions: SessionsSettings,
	application: ApplicationConfigurationSection,
	"ai-features": AiFeaturesSettings,
	"claude-config": ClaudeConfigSettings,
	setup: SetupSettings,
} satisfies Record<SettingsTab, ComponentType>;

type CustomizeDialogPanelModule = typeof import("../customize/customize-dialog-panel");
type CustomizeDialogPanelProps = ComponentProps<CustomizeDialogPanelModule["default"]>;

// Skills, Connectors and Plugins pull in the Customize lists and detail views, so they load on first open.
let customizeDialogPanelModule: Promise<CustomizeDialogPanelModule> | undefined;
let loadedCustomizeDialogPanel: CustomizeDialogPanelModule["default"] | undefined;

/** Starts loading the Customize panel; the nav calls it on hover/focus so the first open needn't wait. */
export function preloadCustomizeDialogPanel(): Promise<CustomizeDialogPanelModule> {
	customizeDialogPanelModule ??= import("../customize/customize-dialog-panel").then((module) => {
		loadedCustomizeDialogPanel = module.default;
		return module;
	});
	return customizeDialogPanelModule;
}

/**
 * Suspends only while the module is still loading. Unlike React.lazy, which suspends on its first render even
 * when the module is already in hand and then holds the reveal for React's 300ms Suspense throttle, a preloaded
 * panel renders in the same pass.
 */
function CustomizeDialogPanel(props: CustomizeDialogPanelProps) {
	const Panel = loadedCustomizeDialogPanel ?? use(preloadCustomizeDialogPanel()).default;
	return <Panel {...props} />;
}

type NavItem = {kind: "settings"; tab: SettingsTab} | {kind: "customize"; section: CustomizeSection};

/** Upstream's nav order: the Customize sections follow Claude Code. */
const NAV_ITEMS: readonly NavItem[] = SettingsTabSchema.options.flatMap((tab): NavItem[] =>
	tab === "claude-code"
		? [
				{kind: "settings", tab},
				...CustomizeSectionSchema.options.map((section): NavItem => ({kind: "customize", section})),
			]
		: [{kind: "settings", tab}],
);

/** Returns a function that opens Settings over the current page at `tab`. */
export function useOpenSettings(): (tab: SettingsTab, row?: string) => void {
	const navigate = useNavigate();
	return useCallback(
		(tab, row) => {
			void navigate({
				to: ".",
				search: true,
				params: true,
				hash: settingsHash(tab, row),
				resetScroll: false,
				hashScrollIntoView: false,
			});
		},
		[navigate],
	);
}

/** How long a deep-linked row stays flashed, as on claude.ai/code. */
const FLASH_MS = 1500;

/**
 * The upstream-shaped Settings modal. It is open exactly while the location hash
 * is `#settings/<tab>[/<row>]` or `#customize/<section>/…`; closing clears the
 * hash and restores focus to whatever was focused when it opened.
 */
export function SettingsDialog() {
	const hash = useLocation({select: (location) => location.hash});
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const current = parseSettingsHash(hash);
	const customize = current === null ? parseCustomizeHash(hash) : null;
	const open = current !== null || customize !== null;
	const returnFocusRef = useRef<HTMLElement | null>(null);

	// The first render with a settings hash runs before Base UI moves focus into
	// the popup, so this still sees whatever the hash change was triggered from.
	if (open && returnFocusRef.current === null) {
		const active = document.activeElement;
		if (active instanceof HTMLElement && active !== document.body) returnFocusRef.current = active;
	}

	useShortcut("settings", () => openSettings("general"));

	const close = useCallback(() => {
		void navigate({
			to: ".",
			search: true,
			params: true,
			resetScroll: false,
			hashScrollIntoView: false,
		});
	}, [navigate]);

	const selectTab = useCallback(
		(tab: SettingsTab, row?: string) => {
			void navigate({
				to: ".",
				search: true,
				params: true,
				hash: settingsHash(tab, row),
				replace: true,
				resetScroll: false,
				hashScrollIntoView: false,
			});
		},
		[navigate],
	);

	const navigateHash = useCallback(
		(nextHash: string, replace: boolean) => {
			void navigate({
				to: ".",
				search: true,
				params: true,
				hash: nextHash,
				replace,
				resetScroll: false,
				hashScrollIntoView: false,
			});
		},
		[navigate],
	);

	const finalFocus = useCallback(() => {
		const target = returnFocusRef.current;
		returnFocusRef.current = null;
		return target !== null && target.isConnected ? target : true;
	}, []);

	const tab = current?.tab ?? "general";
	const Panel = TAB_PANELS[tab];

	// A `#settings/<tab>/<row>` deep link flashes that row, then collapses to `#settings/<tab>`.
	const [flash, setFlash] = useState<SettingsFlash | null>(null);
	const deepLinkRow = current?.row ?? null;
	const [seenDeepLinkRow, setSeenDeepLinkRow] = useState<string | null>(null);
	if (deepLinkRow !== seenDeepLinkRow) {
		setSeenDeepLinkRow(deepLinkRow);
		if (deepLinkRow !== null) setFlash({row: deepLinkRow});
	}
	useEffect(() => {
		if (deepLinkRow !== null) selectTab(tab);
	}, [selectTab, tab, deepLinkRow]);
	useEffect(() => {
		if (flash === null) return;
		const timer = setTimeout(() => setFlash(null), FLASH_MS);
		return () => clearTimeout(timer);
	}, [flash]);

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) close();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
				<Dialog.Popup
					aria-label="Settings"
					finalFocus={finalFocus}
					data-perf-overlay="settings_modal"
					data-perf-screen={customize === null ? tab : `customize-${customize.section}`}
					className="fixed inset-4 z-50 m-auto flex max-h-[50rem] max-w-[1024px] overflow-hidden rounded-card bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] outline-none"
				>
					<nav
						aria-label="Settings"
						className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-subtle bg-surface-1 px-3 py-2"
					>
						<SettingsSearch onSelect={selectTab} />
						{NAV_ITEMS.map((item) => {
							const selected =
								item.kind === "settings"
									? customize === null && item.tab === tab
									: item.section === customize?.section;
							const Icon =
								item.kind === "settings"
									? SETTINGS_TAB_ICONS[item.tab]
									: CUSTOMIZE_SECTION_ICONS[item.section];
							return (
								<button
									key={item.kind === "settings" ? item.tab : `customize-${item.section}`}
									type="button"
									aria-current={selected ? "page" : undefined}
									onPointerEnter={item.kind === "customize" ? preloadCustomizeDialogPanel : undefined}
									onFocus={item.kind === "customize" ? preloadCustomizeDialogPanel : undefined}
									onClick={() =>
										item.kind === "settings"
											? selectTab(item.tab)
											: navigateHash(customizeHash({section: item.section}), true)
									}
									className={`flex h-8 shrink-0 items-center gap-3 rounded-r6 px-2 text-left text-body font-normal transition-colors ${
										selected
											? "bg-fill-control text-primary"
											: "text-secondary hover:bg-fill-ghost-hover"
									}`}
								>
									<Icon aria-hidden="true" className="size-5 shrink-0" />
									{item.kind === "settings"
										? settingsTabLabels[item.tab]
										: customizeSectionLabels[item.section]}
								</button>
							);
						})}
					</nav>
					<div className="flex min-w-0 flex-1 flex-col">
						<div className="flex shrink-0 justify-end p-3">
							<Dialog.Close
								aria-label="Close"
								className="flex h-8 w-8 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover"
							>
								<X aria-hidden="true" className="size-5" />
							</Dialog.Close>
						</div>
						<div className="flex-1 space-y-6 overflow-y-auto px-6 pt-2 pb-4">
							{customize === null ? (
								<SettingsFlashContext.Provider value={flash}>
									<Panel />
								</SettingsFlashContext.Provider>
							) : (
								<Suspense fallback={null}>
									<CustomizeDialogPanel location={customize} onNavigate={navigateHash} />
								</Suspense>
							)}
						</div>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
