import {Dialog} from "@base-ui/react/dialog";
import {useLocation, useNavigate} from "@tanstack/react-router";
import {ChevronRight, X} from "lucide-react";
import {type ComponentProps, Suspense, use, useCallback, useEffect, useRef, useState, type ComponentType} from "react";
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
import {loadedCustomizeDialogPanel, preloadCustomizeDialogPanel} from "./customize-dialog-panel-loader";
import {SettingsFlashContext, type SettingsFlash} from "./settings-row-context";
import {SettingsSearch} from "./settings-search";
import {CUSTOMIZE_SECTION_ICONS, SETTINGS_TAB_ICONS} from "./settings-tab-icons";
import {UsageSettings} from "./usage-settings";
import {usePhoneSheet} from "../../lib/use-phone-sheet";

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

/** Event-handler form of {@link preloadCustomizeDialogPanel}, for hover and focus. */
function warmCustomizeDialogPanel(): void {
	void preloadCustomizeDialogPanel();
}

/**
 * Suspends only while the module is still loading. Unlike React.lazy, which suspends on its first render even
 * when the module is already in hand and then holds the reveal for React's 300ms Suspense throttle, a preloaded
 * panel renders in the same pass.
 */
function CustomizeDialogPanel(props: CustomizeDialogPanelProps) {
	const Panel = loadedCustomizeDialogPanel() ?? use(preloadCustomizeDialogPanel()).default;
	return <Panel {...props} />;
}

type NavItem = {kind: "settings"; tab: SettingsTab} | {kind: "customize"; section: CustomizeSection};

/** All local nav items; grouped below by kind while preserving each kind's relative order. */
const NAV_ITEMS: readonly NavItem[] = SettingsTabSchema.options.flatMap((tab): NavItem[] =>
	tab === "claude-code"
		? [
				{kind: "settings", tab},
				...CustomizeSectionSchema.options.map((section): NavItem => ({kind: "customize", section})),
			]
		: [{kind: "settings", tab}],
);

const NAV_GROUPS = [
	{label: "Settings", items: NAV_ITEMS.filter((item) => item.kind === "settings")},
	{label: "Customize", items: NAV_ITEMS.filter((item) => item.kind === "customize")},
];

function navItemKey(item: NavItem): string {
	return item.kind === "settings" ? item.tab : `customize-${item.section}`;
}

function navItemLabel(item: NavItem): string {
	return item.kind === "settings" ? settingsTabLabels[item.tab] : customizeSectionLabels[item.section];
}

/** Hover and focus handlers that warm the lazily loaded Customize panel before a customize item is chosen. */
function navItemWarmers(item: NavItem) {
	return item.kind === "customize"
		? {onPointerEnter: warmCustomizeDialogPanel, onFocus: warmCustomizeDialogPanel}
		: {};
}

/**
 * Upstream's phone-width tab strip: one horizontally scrolling `role=tablist` of 32px tabs
 * (14/20 w500, px12, inactive muted) with a 32px "Scroll forward" button pinned at its right.
 */
function PhoneTabStrip({
	isSelected,
	onSelect,
}: {
	isSelected: (item: NavItem) => boolean;
	onSelect: (item: NavItem) => void;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const selectedItem = NAV_ITEMS.find(isSelected);

	useEffect(() => {
		const tab = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
		if (typeof tab?.scrollIntoView === "function") tab.scrollIntoView({block: "nearest", inline: "nearest"});
	}, [selectedItem]);

	return (
		<div className="flex shrink-0 items-center gap-1 pb-3">
			<div
				ref={listRef}
				role="tablist"
				aria-label="Settings"
				aria-orientation="horizontal"
				className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain ps-2 [scrollbar-width:none]"
			>
				{NAV_ITEMS.map((item) => {
					const selected = isSelected(item);
					return (
						<button
							key={navItemKey(item)}
							type="button"
							role="tab"
							aria-selected={selected}
							{...navItemWarmers(item)}
							onClick={() => {
								onSelect(item);
							}}
							className={`flex h-8 shrink-0 items-center rounded-r6 px-3 text-[14px]/[20px] font-medium whitespace-nowrap transition-colors ${
								selected
									? "bg-fill-control text-primary"
									: "text-[var(--settings-muted)] hover:bg-fill-ghost-hover"
							}`}
						>
							{navItemLabel(item)}
						</button>
					);
				})}
			</div>
			<button
				type="button"
				aria-label="Scroll forward"
				onClick={() => {
					const list = listRef.current;
					if (list !== null && typeof list.scrollBy === "function") {
						list.scrollBy({left: list.clientWidth * 0.8, behavior: "smooth"});
					}
				}}
				className="flex size-8 shrink-0 items-center justify-center rounded-r6 text-secondary transition-colors hover:bg-fill-ghost-hover"
			>
				<ChevronRight aria-hidden="true" className="size-5" />
			</button>
		</div>
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
		return target?.isConnected === true ? target : true;
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
		if (flash === null) return undefined;
		const timer = setTimeout(() => {
			setFlash(null);
		}, FLASH_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [flash]);

	const phone = usePhoneSheet();
	const isSelected = (item: NavItem) =>
		item.kind === "settings" ? customize === null && item.tab === tab : item.section === customize?.section;
	const selectItem = (item: NavItem) => {
		if (item.kind === "settings") selectTab(item.tab);
		else navigateHash(customizeHash({section: item.section}), true);
	};

	const closeButton = (
		<Dialog.Close
			aria-label="Close"
			className="flex h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover"
		>
			<X aria-hidden="true" className="size-5" />
		</Dialog.Close>
	);

	const content =
		customize === null ? (
			<SettingsFlashContext.Provider value={flash}>
				<Panel />
			</SettingsFlashContext.Provider>
		) : (
			<Suspense fallback={null}>
				<CustomizeDialogPanel location={customize} onNavigate={navigateHash} />
			</Suspense>
		);

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) close();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
				<Dialog.Popup
					aria-label="Settings"
					finalFocus={finalFocus}
					data-perf-overlay="settings_modal"
					data-perf-screen={customize === null ? tab : `customize-${customize.section}`}
					className={`fixed inset-4 z-50 m-auto flex max-h-[50rem] max-w-[1024px] overflow-hidden rounded-card bg-[var(--menu-bg)] dark:bg-surface-2 text-body text-primary dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgba(0,0,0,0.24)] not-dark:shadow-[0_0_0_1px_rgb(11_11_11/0.1),0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgb(11_11_11/0.08)] outline-none ${phone ? "flex-col" : ""}`}
				>
					{phone ? (
						// Upstream at phone width: one scroll container (p-24) holding the header, the tab strip and a single column.
						<div className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
							<div className="flex shrink-0 items-center justify-between gap-3 pb-3">
								<h2 className="text-[22px]/[28px] font-[580] text-primary">Settings</h2>
								{closeButton}
							</div>
							<div className="shrink-0 pb-3">
								<SettingsSearch onSelect={selectTab} />
							</div>
							<PhoneTabStrip isSelected={isSelected} onSelect={selectItem} />
							<div className="min-w-0 space-y-6 pt-2">{content}</div>
						</div>
					) : (
						<>
							<nav
								aria-label="Settings"
								className="flex w-48 shrink-0 flex-col gap-3 border-r border-subtle bg-surface-1"
							>
								<div className="shrink-0 px-3 pt-3">
									<SettingsSearch onSelect={selectTab} />
								</div>
								<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
									{NAV_GROUPS.map((group) => (
										<div
											key={group.label}
											role="group"
											aria-label={group.label}
											className="flex shrink-0 flex-col gap-3"
										>
											<div className="px-2 pt-3 text-[12px]/[17px] text-ink-muted">
												{group.label}
											</div>
											<div className="flex flex-col gap-px">
												{group.items.map((item) => {
													const selected = isSelected(item);
													const Icon =
														item.kind === "settings"
															? SETTINGS_TAB_ICONS[item.tab]
															: CUSTOMIZE_SECTION_ICONS[item.section];
													return (
														<button
															key={navItemKey(item)}
															type="button"
															aria-current={selected ? "page" : undefined}
															{...navItemWarmers(item)}
															onClick={() => {
																selectItem(item);
															}}
															className={`flex h-8 shrink-0 items-center gap-3 rounded-r6 px-2 text-left text-body transition-colors ${
																selected
																	? "bg-fill-control font-medium text-primary"
																	: "font-normal text-secondary hover:bg-fill-ghost-hover"
															}`}
														>
															<Icon
																aria-hidden="true"
																className="size-5 shrink-0 text-secondary"
															/>
															{navItemLabel(item)}
														</button>
													);
												})}
											</div>
										</div>
									))}
								</div>
							</nav>
							<div className="flex min-w-0 flex-1 flex-col">
								<div className="flex shrink-0 justify-end px-3 pt-3 pb-2">{closeButton}</div>
								<div className="flex-1 space-y-6 overflow-y-auto px-6 pt-2 pb-4 [scrollbar-gutter:stable]">
									{content}
								</div>
							</div>
						</>
					)}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
