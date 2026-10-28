import {Dialog} from "@base-ui/react/dialog";
import {useLocation, useNavigate} from "@tanstack/react-router";
import {ChevronRight, X} from "lucide-react";
import {
	type ComponentProps,
	Suspense,
	use,
	useCallback,
	useDeferredValue,
	useEffect,
	useId,
	useRef,
	useState,
	type ComponentType,
} from "react";
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
import {CustomizePanelSkeleton} from "../customize/customize-panel-skeleton";
import {preloadCustomizeDialogPanel} from "./customize-dialog-panel-loader";
import {SettingsFlashContext, type SettingsFlash, SettingsTabContext} from "./settings-row-context";
import {SettingsSearch} from "./settings-search";
import {CUSTOMIZE_SECTION_ICONS, SETTINGS_TAB_ICONS} from "./settings-tab-icons";
import {UsageSettings} from "./usage-settings";
import {SETTINGS_PHONE_QUERY, useMediaQuery} from "../../lib/use-phone-sheet";
import {DensityScope} from "../ui/density";

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
 * panel renders in the same pass. use() runs on every render: the download tags itself fulfilled, so a loaded module
 * returns synchronously rather than skipping use(), which React flags as conditional use() after a suspension.
 */
export function CustomizeDialogPanel(props: CustomizeDialogPanelProps) {
	const Panel = use(preloadCustomizeDialogPanel()).default;
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

/** claude.ai/code lights a deep-linked row this long after opening, once the scroll has landed. */
const FLASH_DELAY_MS = 300;
/** How long a deep-linked row stays lit, matching upstream's 1.95s highlight animations. */
const FLASH_MS = 1950;

/**
 * The upstream-shaped Settings modal. It is open exactly while the location hash
 * is `#settings/<tab>[/<row>]` or `#customize/<section>/…`; closing clears the
 * hash and restores focus to whatever was focused when it opened.
 */
export function SettingsDialog() {
	const titleId = useId();
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

	// Upstream's warm switch: the nav moves at once, but the panel renders from a deferred hash, so a section
	// that suspends keeps the previous panel on screen (dimmed below) under the stable Suspense boundary. A
	// deferred hash that doesn't open the dialog falls back to the live one, so a cold open shows the skeleton.
	const deferredHash = useDeferredValue(hash);
	const deferredCurrent = parseSettingsHash(deferredHash);
	const deferredCustomize = deferredCurrent === null ? parseCustomizeHash(deferredHash) : null;
	const deferredOpen = deferredCurrent !== null || deferredCustomize !== null;
	const shownCurrent = deferredOpen ? deferredCurrent : current;
	const shownCustomize = deferredOpen ? deferredCustomize : customize;
	const shownTab = shownCurrent?.tab ?? "general";
	const switching = deferredOpen && deferredHash !== hash;
	const Panel = TAB_PANELS[shownTab];

	// A `#settings/<tab>/<row>` deep link flashes that row, then collapses to `#settings/<tab>`.
	const [flash, setFlash] = useState<SettingsFlash | null>(null);
	const deepLinkRow = current?.row ?? null;
	const [seenDeepLinkRow, setSeenDeepLinkRow] = useState<string | null>(null);
	if (deepLinkRow !== seenDeepLinkRow) {
		setSeenDeepLinkRow(deepLinkRow);
		if (deepLinkRow !== null) setFlash({row: deepLinkRow, lit: false});
	}
	useEffect(() => {
		if (deepLinkRow !== null) selectTab(tab);
	}, [selectTab, tab, deepLinkRow]);
	useEffect(() => {
		if (flash === null) return undefined;
		const timer = flash.lit
			? setTimeout(() => {
					setFlash(null);
				}, FLASH_MS)
			: setTimeout(() => {
					setFlash({row: flash.row, lit: true});
				}, FLASH_DELAY_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [flash]);

	// Upstream's phone layout (tab strip, no search) applies at ≤767px, not the sidebar sheet's 640px.
	const phone = useMediaQuery(SETTINGS_PHONE_QUERY);
	const isSelected = (item: NavItem) =>
		item.kind === "settings" ? customize === null && item.tab === tab : item.section === customize?.section;
	const selectItem = (item: NavItem) => {
		if (item.kind === "settings") selectTab(item.tab);
		// Upstream replaces the entry coming from a Settings tab but pushes one between customize sections.
		else navigateHash(customizeHash({section: item.section}), customize === null);
	};

	const closeButton = (
		<Dialog.Close
			aria-label="Close"
			className="flex h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover"
		>
			<X aria-hidden="true" className="size-5" />
		</Dialog.Close>
	);

	const content = (
		<Suspense
			fallback={
				shownCustomize === null ? null : (
					<CustomizePanelSkeleton title={customizeSectionLabels[shownCustomize.section]} />
				)
			}
		>
			{shownCustomize === null ? (
				<SettingsTabContext.Provider value={shownTab}>
					<SettingsFlashContext.Provider value={flash}>
						<Panel />
					</SettingsFlashContext.Provider>
				</SettingsTabContext.Provider>
			) : (
				<CustomizeDialogPanel location={shownCustomize} onNavigate={navigateHash} />
			)}
		</Suspense>
	);
	// Upstream dims the old panel's scroll container while the next one is pending.
	const pendingClass = switching ? " opacity-60 transition-opacity" : "";

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) close();
			}}
		>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 dark:bg-black/50 transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-reduce:transition-none" />
					<Dialog.Popup
						aria-labelledby={titleId}
						finalFocus={finalFocus}
						data-perf-overlay="settings_modal"
						data-perf-screen={customize === null ? tab : `customize-${customize.section}`}
						className={`fixed inset-4 z-50 m-auto flex max-h-[50rem] max-w-[1024px] overflow-hidden dark:border dark:border-white/5 rounded-card bg-[var(--menu-bg)] dark:bg-surface-2 text-body text-primary dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgba(0,0,0,0.24)] not-dark:shadow-[0_0_0_1px_rgb(11_11_11/0.1),0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgb(11_11_11/0.08)] outline-none transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] motion-reduce:data-[starting-style]:scale-100 data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98] ${phone ? "flex-col" : ""}`}
					>
						{phone ? (
							// Upstream at phone width: one scroll container (p-24) holding the header, the tab strip and a single column; no search.
							<div className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
								<div className="flex shrink-0 items-center justify-between gap-3 pb-3">
									<h2 id={titleId} className="text-[22px]/[28px] font-[580] text-primary">
										Settings
									</h2>
									{closeButton}
								</div>
								<PhoneTabStrip isSelected={isSelected} onSelect={selectItem} />
								<div
									aria-busy={switching || undefined}
									className={`min-w-0 space-y-6 pt-2${pendingClass}`}
								>
									{content}
								</div>
							</div>
						) : (
							<>
								<h2 id={titleId} className="sr-only">
									Settings
								</h2>
								<nav
									aria-label="Settings"
									className="flex w-48 shrink-0 flex-col gap-3 border-r border-subtle bg-surface-1"
								>
									<div className="shrink-0 px-3 pt-3">
										<SettingsSearch onSelect={selectTab} />
									</div>
									<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
										{NAV_GROUPS.map((group) => (
											<div key={group.label} className="flex shrink-0 flex-col gap-3">
												<div
													id={`${titleId}-${group.label}`}
													className="px-2 pt-3 text-[12px]/[17px] text-ink-muted"
												>
													{group.label}
												</div>
												<ul
													aria-labelledby={`${titleId}-${group.label}`}
													className="flex flex-col gap-px"
												>
													{group.items.map((item) => {
														const selected = isSelected(item);
														const Icon =
															item.kind === "settings"
																? SETTINGS_TAB_ICONS[item.tab]
																: CUSTOMIZE_SECTION_ICONS[item.section];
														return (
															<li
																key={navItemKey(item)}
																data-testid={`${navItemKey(item)}-settings`}
															>
																<button
																	type="button"
																	aria-current={selected ? "page" : undefined}
																	{...navItemWarmers(item)}
																	onClick={() => {
																		selectItem(item);
																	}}
																	className={`flex h-8 w-full shrink-0 items-center gap-3 rounded-r6 px-2 text-left text-body transition-colors focus-visible:outline-hidden not-dark:focus-visible:shadow-[inset_0_0_0_1px_#fcfcfb,0_0_0_1px_#2a78d6,0_0_6px_1px_#cde2fb] dark:focus-visible:shadow-[inset_0_0_0_1px_rgb(21_21_21),0_0_0_1px_rgb(42_120_214),0_0_6px_1px_rgb(24_79_149/0.6)] ${
																		selected
																			? "bg-fill-control font-medium text-primary"
																			: "font-normal text-secondary hover:bg-fill-ghost-hover hover:text-primary"
																	}`}
																>
																	<Icon
																		aria-hidden="true"
																		className="size-5 shrink-0 text-secondary"
																	/>
																	{navItemLabel(item)}
																</button>
															</li>
														);
													})}
												</ul>
											</div>
										))}
									</div>
								</nav>
								{shownCustomize === null ? (
									<div className="flex min-w-0 flex-1 flex-col">
										<div className="flex shrink-0 items-center justify-between gap-3 px-3 pt-3 pb-2">
											<div className="flex min-w-0 flex-1 items-center" />
											{closeButton}
										</div>
										<div
											aria-busy={switching || undefined}
											className={`flex-1 space-y-6 overflow-y-auto px-6 pt-2 pb-4 [scrollbar-gutter:stable]${pendingClass}`}
										>
											{/* Upstream's scroll-top fade; mb-0! cancels space-y so it adds no height. */}
											<div
												aria-hidden="true"
												className="pointer-events-none sticky -top-2 z-[1] -mx-6 -mt-2 mb-0! h-2 bg-gradient-to-b from-[var(--menu-bg)] to-transparent dark:from-surface-2"
											/>
											{content}
										</div>
									</div>
								) : (
									<div className="flex min-w-0 flex-1 flex-col">
										{/* Upstream's Customize pane owns its chrome: an absolute Close, the crumb bar, then the panel. */}
										<div
											data-customize-dialog-pane=""
											className="relative flex min-h-0 flex-1 flex-col"
										>
											<div data-customize-dialog-chrome="" className="contents">
												<div className="absolute top-0 end-0 z-[2] flex h-14 items-center pe-2">
													{closeButton}
												</div>
											</div>
											<div
												data-testid="customize-dialog-crumb-bar"
												className="flex shrink-0 items-center pt-2 pb-2 ps-5 pe-12"
											>
												<div className="min-h-8 relative flex min-w-0 flex-1 items-center gap-6" />
											</div>
											<div className="relative flex min-h-0 flex-1 flex-col">
												<div
													aria-busy={switching || undefined}
													className={`relative min-h-0 flex-1 overflow-x-hidden overflow-y-hidden${pendingClass}`}
												>
													{content}
												</div>
											</div>
										</div>
									</div>
								)}
							</>
						)}
					</Dialog.Popup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
