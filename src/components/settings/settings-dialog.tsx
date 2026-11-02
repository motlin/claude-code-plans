import {Dialog} from "@base-ui/react/dialog";
import {useLocation, useNavigate} from "@tanstack/react-router";
import {ChevronLeft, ChevronRight, X} from "lucide-react";
import
{
	type ComponentProps,
	Fragment,
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
import {DialogPopup} from "../ui/dialog-popup";
import {customizeSectionLabels} from "../../lib/schema-choices";
import
{
	customizeHash,
	parseCustomizeHash,
	parseSettingsHash,
	settingsHash,
	type SettingsTab,
} from "../../lib/settings-hash";
import
{
	AiFeaturesSettings,
	ApplicationConfigurationSection,
	ClaudeCodeSettings,
	ClaudeConfigSettings,
	GeneralSettings,
	NotificationsSettings,
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
import {CDS_TAB_CLASS, CDS_TAB_LIST_CLASS} from "../ui/cds-tabs";
import {DensityScope} from "../ui/density";
import {DIALOG_BODY_CLASS} from "../ui/dialog-classes";
import
{
	navRowFor,
	navRowLabel,
	SETTINGS_NAV_ROWS,
	type SettingsNavMember,
	type SettingsNavRow,
	settingsNavGroups,
} from "../../lib/settings-nav";

const TAB_PANELS =
{
	general: GeneralSettings,
	notifications: NotificationsSettings,
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
function warmCustomizeDialogPanel(): void
{
	void preloadCustomizeDialogPanel();
}

/**
 * Suspends only while the module is still loading. Unlike React.lazy, which suspends on its first render even
 * when the module is already in hand and then holds the reveal for React's 300ms Suspense throttle, a preloaded
 * panel renders in the same pass. use() runs on every render: the download tags itself fulfilled, so a loaded module
 * returns synchronously rather than skipping use(), which React flags as conditional use() after a suspension.
 */
export function CustomizeDialogPanel(props: CustomizeDialogPanelProps)
{
	const Panel = use(preloadCustomizeDialogPanel()).default;
	return <Panel {...props} />;
}

/** The desktop nav's row groups (upstream's grouped nav: untitled groups split by separators). */
const NAV_ROW_GROUPS = settingsNavGroups();

/** Hover and focus handlers that warm the lazily loaded Customize panel before a customize row is chosen. */
function navRowWarmers(row: SettingsNavRow)
{
	return row.members[0].kind === "customize"
		?
			{
				onPointerEnter: warmCustomizeDialogPanel,
				onFocus: warmCustomizeDialogPanel,
			}
		: {};
}

/** Upstream's row base `MV` (comfortable: h-list-row 32, gap-sm 12, px-sm 8, rounded 8) with the shadow-focus pair. */
const NAV_ROW_CLASS =
	"hit-row hit-row-main flex h-8 w-full items-center gap-3 rounded-r6 px-2 text-start text-body focus-visible:outline-hidden not-dark:focus-visible:shadow-[inset_0_0_0_1px_#fcfcfb,0_0_0_1px_#257de0,0_0_6px_1px_#cde2fb] dark:focus-visible:shadow-[inset_0_0_0_1px_rgb(21_21_21),0_0_0_1px_rgb(37_125_224),0_0_6px_1px_rgb(24_79_149/0.6)]";

/** Upstream S6's classes: `MV`, `pe-xs` unless the row stands for customize sections (`Ko`), then `Mc(active)`. */
function navRowClass(row: SettingsNavRow, selected: boolean): string
{
	const end = row.members[0].kind === "customize" ? "" : " pe-1.5";
	const state = selected
		? "bg-fill-ghost-selected hover:layers-1-fill-ghost-hover font-medium text-primary"
		: "text-secondary-control hover:bg-fill-ghost-hover hover:text-primary";
	return `${NAV_ROW_CLASS}${end} ${state}`;
}

/**
 * Upstream's phone-width tab strip, a cds Tabs root (`Ct.Root` > paged scroller > `Ct.List`): one horizontally
 * scrolling `role=tablist` of cds tabs (the shared recipe at comfortable 28px; the 2026-11-01 700px dump's 32px
 * predates fizzy-lake panels) between cds Tabs' 32px pager controls, "Scroll back"
 * (`data-toward=start`) and "Scroll forward" (`data-toward=end`), each shown only while the strip
 * can still move that way.
 */
function PhoneTabStrip({
	isSelected,
	onSelect,
}: {
	isSelected: (row: SettingsNavRow) => boolean;
	onSelect: (row: SettingsNavRow) => void;
})
{
	const listRef = useRef<HTMLDivElement>(null);
	const selectedRow = SETTINGS_NAV_ROWS.find(isSelected);
	const [edges, setEdges] = useState(
		{
			atStart: true,
			atEnd: true,
		},
	);
	const measure = useCallback(() =>
	{
		const list = listRef.current;
		if (list === null) return;
		const atStart = list.scrollLeft <= 0;
		const atEnd = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
		setEdges((previous) =>
			previous.atStart === atStart && previous.atEnd === atEnd
				? previous
				:
					{
						atStart,
						atEnd,
					},
		);
	}, []);

	useEffect(() =>
	{
		measure();
		const list = listRef.current;
		if (list === null || typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(list);
		return () =>
		{
			observer.disconnect();
		};
	}, [measure]);

	const page = (direction: 1 | -1, fraction: number) =>
	{
		const list = listRef.current;
		if (list !== null && typeof list.scrollBy === "function")
		{
			list.scrollBy(
				{
					left: direction * list.clientWidth * fraction,
					behavior: "smooth",
				},
			);
		}
	};
	const pagerClass =
		"flex size-8 shrink-0 items-center justify-center rounded-r6 text-secondary transition-colors hover:bg-fill-ghost-hover";

	useEffect(() =>
	{
		const tab = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
		if (typeof tab?.scrollIntoView === "function")
			tab.scrollIntoView(
				{
					block: "nearest",
					inline: "nearest",
				},
			);
	}, [selectedRow]);

	return (
		<div data-cds="Tabs" data-orientation="horizontal" data-activation-direction="none" className="shrink-0 pb-3">
			<div data-paged="" className="relative flow-root min-w-0">
				<div className="flex items-center gap-1">
					<button
						type="button"
						aria-label="Scroll back"
						data-toward="start"
						hidden={edges.atStart}
						onClick={() =>
						{
							page(-1, 1);
						}}
						className={pagerClass}
					>
						<ChevronLeft aria-hidden="true" className="size-5" />
					</button>
					<div
						ref={listRef}
						onScroll={measure}
						role="tablist"
						aria-label="Settings"
						aria-orientation="horizontal"
						className={`${CDS_TAB_LIST_CLASS} min-w-0 flex-1 overflow-x-auto overscroll-x-contain ps-2 [scrollbar-width:none]`}
					>
						{SETTINGS_NAV_ROWS.map((row) =>
						{
							const selected = isSelected(row);
							return (
								<button
									key={row.testId}
									type="button"
									role="tab"
									data-testid={row.testId}
									aria-selected={selected}
									data-active={selected ? "" : undefined}
									{...navRowWarmers(row)}
									onClick={() =>
									{
										onSelect(row);
									}}
									className={CDS_TAB_CLASS}
								>
									{navRowLabel(row)}
								</button>
							);
						})}
					</div>
					<button
						type="button"
						aria-label="Scroll forward"
						data-toward="end"
						hidden={edges.atEnd}
						onClick={() =>
						{
							page(1, 0.8);
						}}
						className={pagerClass}
					>
						<ChevronRight aria-hidden="true" className="size-5" />
					</button>
				</div>
			</div>
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
export function SettingsDialog()
{
	const titleId = useId();
	const hash = useLocation(
		{
			select: (location) => location.hash,
		},
	);
	const navigate = useNavigate();
	const current = parseSettingsHash(hash);
	const customize = current === null ? parseCustomizeHash(hash) : null;
	const open = current !== null || customize !== null;
	const returnFocusRef = useRef<HTMLElement | null>(null);

	// The first render with a settings hash runs before Base UI moves focus into
	// the popup, so this still sees whatever the hash change was triggered from.
	if (open && returnFocusRef.current === null)
	{
		const active = document.activeElement;
		if (active instanceof HTMLElement && active !== document.body) returnFocusRef.current = active;
	}

	const close = useCallback(() =>
	{
		void navigate(
			{
				to: ".",
				search: true,
				params: true,
				resetScroll: false,
				hashScrollIntoView: false,
			},
		);
	}, [navigate]);

	const selectTab = useCallback(
		(tab: SettingsTab, row?: string) =>
		{
			void navigate(
				{
					to: ".",
					search: true,
					params: true,
					hash: settingsHash(tab, row),
					replace: true,
					resetScroll: false,
					hashScrollIntoView: false,
				},
			);
		},
		[navigate],
	);

	const navigateHash = useCallback(
		(nextHash: string, replace: boolean) =>
		{
			void navigate(
				{
					to: ".",
					search: true,
					params: true,
					hash: nextHash,
					replace,
					resetScroll: false,
					hashScrollIntoView: false,
				},
			);
		},
		[navigate],
	);

	const finalFocus = useCallback(() =>
	{
		const target = returnFocusRef.current;
		returnFocusRef.current = null;
		return target?.isConnected === true ? target : true;
	}, []);

	// Upstream's search focuses its input on open (focusVisible:false, so no focus ring), not the trigger
	// wrapper div that Base UI's default (first tabbable) would pick. The phone layout has no search.
	const searchInputRef = useRef<HTMLInputElement>(null);
	const initialFocus = useCallback(() =>
	{
		const input = searchInputRef.current;
		if (input === null) return true;
		input.focus(
			{
				preventScroll: true,
				focusVisible: false,
			},
		);
		return false;
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
	if (deepLinkRow !== seenDeepLinkRow)
	{
		setSeenDeepLinkRow(deepLinkRow);
		if (deepLinkRow !== null)
			setFlash(
				{
					row: deepLinkRow,
					lit: false,
				},
			);
	}
	useEffect(() =>
	{
		if (deepLinkRow !== null) selectTab(tab);
	}, [selectTab, tab, deepLinkRow]);
	useEffect(() =>
	{
		if (flash === null) return undefined;
		const timer = flash.lit
			? setTimeout(() =>
				{
					setFlash(null);
				}, FLASH_MS)
			: setTimeout(() =>
				{
					setFlash(
						{
							row: flash.row,
							lit: true,
						},
					);
				}, FLASH_DELAY_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [flash]);

	// Upstream's phone layout (tab strip, no search) applies at ≤767px, not the sidebar sheet's 640px.
	const phone = useMediaQuery(SETTINGS_PHONE_QUERY);
	const currentMember: SettingsNavMember =
		customize === null
			?
				{
					kind: "settings",
					tab,
				}
			:
				{
					kind: "customize",
					section: customize.section,
				};
	// Upstream's standsFor: a row is current for every member, so Customize is current on any customize section.
	const isRowSelected = (row: SettingsNavRow) => navRowFor(currentMember) === row;
	// A row selects its first member; Customize replaces the entry and is a no-op while that member is current.
	const selectRow = (row: SettingsNavRow) =>
	{
		const [first] = row.members;
		if (first.kind === "settings") selectTab(first.tab);
		else if (customize?.section !== first.section)
			navigateHash(
				customizeHash(
					{
						section: first.section,
					},
				),
				true,
			);
	};

	const closeButton = (
		<Dialog.Close
			aria-label="Close"
			className={`flex ${phone ? "size-8" : "size-7"} shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover`}
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
						{/* Upstream's panel opens with an sr-only h2 named by its nav row ("Appearance", "Code"…). */}
						<h2 className="sr-only">
							{navRowLabel(
								navRowFor(
									{
										kind: "settings",
										tab: shownTab,
									},
								),
							)}
						</h2>
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
			onOpenChange={(nextOpen) =>
			{
				if (!nextOpen) close();
			}}
		>
			<Dialog.Portal>
				<DensityScope density="comfortable">
					<Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 dark:bg-black/50 transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-reduce:transition-none" />
					<DialogPopup
						unstyled
						aria-labelledby={titleId}
						initialFocus={initialFocus}
						finalFocus={finalFocus}
						data-perf-overlay="settings_modal"
						data-perf-screen={customize === null ? tab : `customize-${customize.section}`}
						className={`fixed inset-4 z-50 m-auto ${phone ? "flex flex-col" : "grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]"} max-h-[50rem] max-w-[1024px] overflow-hidden dark:border dark:border-white/5 rounded-card bg-[var(--menu-bg)] dark:bg-surface-2 text-body text-primary dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgba(0,0,0,0.24)] not-dark:shadow-[0_0_0_1px_rgb(11_11_11/0.1),0_1px_2px_rgb(11_11_11/0.06),0_2px_8px_rgb(11_11_11/0.08)] outline-none transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-reduce:transition-none data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] motion-reduce:data-[starting-style]:scale-100 data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.98]`}
					>
						{phone ? (
							// Upstream at phone width: one scroll container (p-24) holding the header, the tab strip and a single column; no search.
							<div className={`${DIALOG_BODY_CLASS} p-6`}>
								<div className="flex shrink-0 items-center justify-between gap-3 pb-3">
									<h2
										id={titleId}
										className="min-w-0 flex-1 text-[15px]/[20px] font-[520] text-primary"
									>
										Settings
									</h2>
									{closeButton}
								</div>
								<PhoneTabStrip isSelected={isRowSelected} onSelect={selectRow} />
								<div
									aria-busy={switching || undefined}
									className={`min-w-0 space-y-6 pt-2${pendingClass}`}
								>
									{content}
								</div>
							</div>
						) : (
							// Upstream's grid shell: nav (row 2), the full-width top row band (row 1), then the panel.
							<div className="contents">
								<nav
									aria-label="Settings"
									className="row-start-2 flex w-[212px] min-h-0 shrink-0 flex-col border-e border-[rgb(0_0_0/0.1)] dark:border-white/10 bg-surface-1"
								>
									<h2 id={titleId} className="sr-only">
										Settings
									</h2>
									<div className="shrink-0 px-4 pt-4">
										<SettingsSearch inputRef={searchInputRef} onSelect={selectTab} />
									</div>
									<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-fade-y scroll-fade-hide-top scroll-fade-size-6 scroll-pt-2 px-4 pt-3 pb-4">
										{NAV_ROW_GROUPS.map((group, index) => (
											<Fragment key={group.group}>
												{index > 0 && (
													<div aria-hidden="true" className="mx-2 border-t border-alpha-2" />
												)}
												<ul className="flex flex-col hit-gap-y-px">
													{group.rows.map((row) =>
													{
														const selected = isRowSelected(row);
														const [first] = row.members;
														const Icon =
															first.kind === "settings"
																? SETTINGS_TAB_ICONS[first.tab]
																: CUSTOMIZE_SECTION_ICONS[first.section];
														return (
															<li key={row.testId} data-testid={row.testId}>
																<button
																	type="button"
																	aria-current={selected ? "page" : undefined}
																	{...navRowWarmers(row)}
																	onClick={() =>
																	{
																		selectRow(row);
																	}}
																	className={navRowClass(row, selected)}
																>
																	<Icon
																		aria-hidden="true"
																		className="size-5 shrink-0 text-secondary-control"
																	/>
																	<span className="min-w-0 flex-1 truncate">
																		{navRowLabel(row)}
																	</span>
																</button>
															</li>
														);
													})}
												</ul>
											</Fragment>
										))}
									</div>
								</nav>
								<div
									data-testid="settings-top-row"
									className="col-span-full row-start-1 flex shrink-0 items-center justify-between gap-3 border-b border-[rgb(0_0_0/0.12)] dark:border-white/10 ps-4 pe-2 min-h-11"
								>
									<div
										aria-hidden="true"
										className="min-w-0 [overflow-wrap:anywhere] text-[15px]/[20px] font-[520] text-primary"
									>
										Settings
									</div>
									{closeButton}
								</div>
								{shownCustomize === null ? (
									<div className="flex min-h-0 min-w-0 flex-1 flex-col">
										<div
											aria-busy={switching || undefined}
											className={`relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable]${pendingClass}`}
										>
											{content}
										</div>
									</div>
								) : (
									<div className="flex min-h-0 min-w-0 flex-1 flex-col">
										{/* Upstream's Customize pane: an empty chrome slot (Close lives in the top row), the crumb bar, then the panel. */}
										<div
											data-customize-dialog-pane=""
											className="relative flex min-h-0 flex-1 flex-col"
										>
											<div data-customize-dialog-chrome="" className="contents" />
											<div
												data-testid="customize-dialog-crumb-bar"
												className="flex shrink-0 items-center pt-3 pb-2 ps-5 pe-4 has-[>:empty]:pb-0 max-md:has-[>:empty]:hidden [&>:empty]:hidden"
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
							</div>
						)}
					</DialogPopup>
				</DensityScope>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
