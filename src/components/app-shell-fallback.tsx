import {Ellipsis, Folder, Plus} from "lucide-react";
import {useEffect, useState} from "react";
import {DEFAULT_VISIBLE_NAV_SECTIONS} from "../lib/nav-sections";
import {DEFAULT_SIDEBAR_STATE} from "../lib/sidebar-store";
import {getVisibleNavItems, navItems} from "./sidebar/navigation";
import {SidebarToggleIcon} from "./sidebar/primitives";
import {SEARCH_FIELD_CLASS, SEARCH_FIELD_WRAPPER_CLASS, SearchFieldContents} from "./sidebar/sidebar-search-field";
import {useShortcutKeys} from "../hooks/use-shortcut";
import {ROW_CLASS as SESSION_ROW_CLASS} from "./sidebar/session-group-section";
import {SessionSkeleton} from "./session-skeleton";
import {Skeleton} from "./ui/skeleton";
import {HOME_COLUMN} from "./home/home-column";
import {HomeTitlebar} from "./home/home-page";
import type {ShellChinLabels} from "../lib/shell-chin-store";
import {
	ADD_BUTTON_CLASS,
	CHIN_TRIGGER_CLASS,
	COMPOSER_CARD_CLASS,
	COMPOSER_CHIN_CLASS,
	EFFORT_LABEL_CLASS,
	ENVIRONMENT_BAR_CLASS,
	ENVIRONMENT_BAR_ROW_CLASS,
	ENVIRONMENT_PLACE_CLASS,
	PLACE_CHIP_CLASS,
	USAGE_RING_CLASS,
} from "./composer-tokens";
import {HOME_DOCK_CLASS, SESSION_DOCK_COLUMN_CLASS, SESSION_FOOTER_CLASS, SESSION_TILE_CLASS} from "./dock-tokens";

const NAV_ROW_CLASS =
	"df-nav-row h-[var(--sb-row-h)] rounded-[var(--sb-radius)] flex-1 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]";
const BAR_CLASS = "animate-pulse rounded bg-fill-ghost-hover";
const SESSION_ROW_WIDTHS = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-3/5", "w-4/5", "w-2/3", "w-1/2"];

/**
 * Static app frame painted from the server response.
 *
 * The root route sets `ssr: false`, so no route renders any HTML on the server
 * and the client cannot paint until the bundle downloads, parses and hydrates.
 * This component lives in `shellComponent`, which does render on the server, so
 * a hard load paints the current shell's layout immediately instead of a blank
 * white frame: the sidebar's titlebar, New row, nav and session list, and the
 * same session skeleton an in-app switch shows, above the composer. It
 * removes itself on hydration, at which point the real `RootLayout` is already
 * mounted underneath it.
 */

/**
 * Upstream draws its composer while loading: the card with the + and the placeholder, over the
 * chin's mode, model and effort, and usage ring. It reuses the live composer's classes so
 * hydration does not move anything. The server fills in the labels from settings.json and records
 * them on the chin, where the hydrating client reads them back. On home the chin's controls sit in
 * the environment bar after a placeholder for the project picker, as the live home composer's do.
 */
function FallbackComposer({
	placeholder,
	chin,
	environment = false,
}: {
	placeholder: string;
	chin: ShellChinLabels | null;
	environment?: boolean;
}) {
	const painted = chin === null ? undefined : JSON.stringify(chin);
	return (
		<div data-cds="ChatComposer" className="flex w-full min-w-0 flex-col font-sans">
			<div data-fallback-composer="" className={COMPOSER_CARD_CLASS}>
				<div className="relative pr-[30px] pl-[30px]">
					<div className="absolute left-0 bottom-0 flex min-h-7 items-center">
						<span data-fallback-add="" className={ADD_BUTTON_CLASS}>
							<Plus data-fallback-chin-readout="" aria-hidden="true" className="size-[18px]" />
						</span>
					</div>
					<span
						data-fallback-placeholder=""
						className="block py-1 pl-1 text-[14px]/[20px] text-[rgb(137,135,129)]"
					>
						{placeholder}
					</span>
				</div>
			</div>
			{environment ? (
				<div data-fallback-environment-bar="" data-fallback-chin={painted} className={ENVIRONMENT_BAR_CLASS}>
					<div className={ENVIRONMENT_BAR_ROW_CLASS}>
						<div className={ENVIRONMENT_PLACE_CLASS}>
							<span className={PLACE_CHIP_CLASS}>
								<Folder aria-hidden="true" className="-ms-1 size-4 shrink-0" />
								<span className={`h-3 w-16 ${BAR_CLASS}`} />
							</span>
						</div>
						<FallbackChinControls chin={chin} />
					</div>
				</div>
			) : (
				<div data-cds="ChatComposerChin" data-fallback-chin={painted} className={COMPOSER_CHIN_CLASS}>
					<FallbackChinControls chin={chin} />
				</div>
			)}
		</div>
	);
}

/** The chin's mode, then its model and effort beside the usage ring, as the live ComposerChin lays them out. */
function FallbackChinControls({chin}: {chin: ShellChinLabels | null}) {
	return (
		<>
			<span className="flex min-w-0 items-center self-start">
				<span data-fallback-chin-readout="" className={CHIN_TRIGGER_CLASS}>
					{chin?.mode}
				</span>
			</span>
			<span data-fallback-chin-end="" className="ms-auto flex min-w-0 items-center gap-1 ps-2">
				<span data-fallback-chin-readout="" className={CHIN_TRIGGER_CLASS}>
					{chin && (
						<>
							<span className="truncate">{chin.model}</span>
							<span className={EFFORT_LABEL_CLASS}>{` ${chin.effort}`}</span>
						</>
					)}
				</span>
				<span className={USAGE_RING_CLASS}>
					<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
						<circle cx="6" cy="6" r="5" fill="none" strokeWidth="2" stroke="var(--color-alpha-2)" />
					</svg>
				</span>
			</span>
		</>
	);
}

/**
 * The artifacts page while it loads, in its own layout: the root's top row and gutter-less slot, the
 * page's own padded max-width box with the compact header's title and tab row, then a card grid like the
 * loaded page's.
 */
function ArtifactsSkeleton() {
	return (
		<div data-testid="artifacts-skeleton" className="min-h-0 flex-1 overflow-hidden">
			<div className="min-h-9 max-sm:h-12" />
			<div>
				<div className="mx-auto flex sm:-mt-1 w-full max-w-5xl flex-col px-2 md:px-8">
					<span className={`h-8 w-36 ${BAR_CLASS}`} />
					<div className="mt-5 flex h-8 items-center gap-2">
						<span className={`h-6 w-10 ${BAR_CLASS}`} />
						<span className={`h-6 w-12 ${BAR_CLASS}`} />
						<span className={`h-6 w-28 ${BAR_CLASS}`} />
						{/* Upstream holds only Search and List view while loading: no Filter button yet. */}
						<span data-artifacts-skeleton-toolbar="" className="ms-auto flex gap-2">
							{[0, 1].map((index) => (
								<span key={index} className={`size-6 ${BAR_CLASS}`} />
							))}
						</span>
					</div>
					<div
						data-artifacts-skeleton-grid=""
						className="grid grid-cols-1 gap-6 pt-7 sm:grid-cols-2 md:grid-cols-3"
					>
						{[0, 1, 2, 3, 4, 5].map((index) => (
							<div
								key={index}
								data-artifacts-skeleton-card=""
								className="flex h-full flex-col rounded-card bg-surface-2 shadow-card-ring"
							>
								<div className="h-[160px]" />
								<div className="mx-px border-t border-alpha-1" />
								<div className="flex flex-col gap-1.5 p-3.5">
									<div className="flex h-[1lh] items-center text-body">
										<Skeleton className="rounded" style={{width: "70%", height: 14}} />
									</div>
									<div className="flex h-[1lh] items-center text-caption">
										<Skeleton className="rounded" style={{width: "50%", height: 11}} />
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

/** The home page while it loads, in its own layout: "New session" titlebar, Sessions rows and the home composer. */
function HomeSkeleton({chin}: {chin: ShellChinLabels | null}) {
	return (
		<div data-testid="home-skeleton" className="@container/tile-slot flex h-full min-h-0 flex-col">
			<HomeTitlebar />
			<div className={`min-h-0 flex-1 overflow-hidden ${HOME_COLUMN}`}>
				<section className="flex flex-col gap-2 pt-6">
					<header className="flex items-center gap-1">
						<h2 className="text-[13px] leading-[19px] font-normal text-primary">Sessions</h2>
					</header>
					<ul className="flex flex-col gap-1">
						{HOME_ROW_WIDTHS.map((width) => (
							<li
								key={width}
								data-home-skeleton-row=""
								className="flex h-10 items-center rounded-r6 bg-alpha-1 px-[5px]"
							>
								<span className={`ms-6 h-3.5 ${width} ${BAR_CLASS}`} />
							</li>
						))}
					</ul>
				</section>
			</div>
			<div className={`shrink-0 ${HOME_COLUMN}`}>
				<div className={HOME_DOCK_CLASS}>
					<FallbackComposer placeholder="Describe a task or ask a question" chin={chin} environment />
				</div>
			</div>
		</div>
	);
}

/** The labels the server painted, so hydration renders the same chin; null outside a hydrating page. */
function readPaintedChin(): ShellChinLabels | null {
	if (typeof document === "undefined") return null;
	const painted = document
		.querySelector("#app-shell-fallback [data-fallback-chin]")
		?.getAttribute("data-fallback-chin");
	if (!painted) return null;
	try {
		const parsed: unknown = JSON.parse(painted);
		return isShellChinLabels(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isShellChinLabels(value: unknown): value is ShellChinLabels {
	if (typeof value !== "object" || value === null) return false;
	const {mode, model, effort} = value as Partial<Record<keyof ShellChinLabels, unknown>>;
	return typeof mode === "string" && typeof model === "string" && typeof effort === "string";
}

const HOME_ROW_WIDTHS = ["w-1/2", "w-2/5", "w-3/5", "w-1/3", "w-5/12"];

export function AppShellFallback({
	pathname = "",
	chin = null,
}: {
	pathname?: string;
	/** The chin's labels, which only the server knows; null paints the chin's icons alone. */
	chin?: ShellChinLabels | null;
}) {
	const [hydrated, setHydrated] = useState(false);
	const [labels] = useState(() => chin ?? readPaintedChin());
	const {keys: searchKeys} = useShortcutKeys("search_or_start");

	useEffect(() => {
		setHydrated(true);
	}, []);

	if (hydrated) return null;

	return (
		<div
			id="app-shell-fallback"
			data-testid="app-shell-fallback"
			aria-hidden="true"
			className="flex h-[var(--app-visual-viewport-height,100dvh)]"
		>
			<div
				aria-label="Sidebar"
				style={{"--sidebar-width": `${DEFAULT_SIDEBAR_STATE.width}px`}}
				className="relative hidden h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r-[0.5px] border-border bg-[var(--sb-bg)] min-[701px]:flex"
			>
				<div className="flex h-11 shrink-0 items-center px-2">
					<div className="flex w-8 shrink-0 justify-center self-start pt-3">
						<span className="flex size-6 items-center justify-center text-secondary opacity-70 [&_svg]:size-4">
							<SidebarToggleIcon />
						</span>
					</div>
					<span className="ml-1.5 font-voice text-[20px] leading-none font-medium whitespace-nowrap text-primary">
						Claude Code Browser
					</span>
				</div>
				<div className="h-2 shrink-0" />

				<div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2">
					<div className="shrink-0">
						<div className={SEARCH_FIELD_WRAPPER_CLASS}>
							<span className={SEARCH_FIELD_CLASS}>
								<SearchFieldContents keys={searchKeys} />
							</span>
						</div>
						<div className="flex items-center">
							<span className={NAV_ROW_CLASS}>
								<span className="df-leading-slot [--sb-icon:16px]">
									<span className="df-new-icon-circle">
										<Plus aria-hidden="true" />
									</span>
								</span>
								<span className="min-w-0 flex-1 truncate">New</span>
							</span>
						</div>
						{getVisibleNavItems(navItems, DEFAULT_VISIBLE_NAV_SECTIONS).pinned.map((item) => {
							const Icon = item.icon;
							return (
								<span key={item.to} className={NAV_ROW_CLASS}>
									<span className="df-leading-slot">
										<Icon aria-hidden="true" />
									</span>
									<span className="min-w-0 flex-1 truncate">{item.label}</span>
								</span>
							);
						})}
						<div className="flex items-center">
							<span className={NAV_ROW_CLASS}>
								<span className="df-leading-slot">
									<Ellipsis aria-hidden="true" />
								</span>
								<span className="min-w-0 flex-1 truncate">More</span>
							</span>
						</div>
						<div className="h-[13px] shrink-0" />
					</div>

					<div className={SESSION_ROW_CLASS}>
						<span className={`h-3 w-16 ${BAR_CLASS}`} />
					</div>
					{SESSION_ROW_WIDTHS.map((width, index) => (
						<div key={index} data-fallback-session-row="" className={SESSION_ROW_CLASS}>
							<span className={`h-3.5 ${width} ${BAR_CLASS}`} />
						</div>
					))}
				</div>

				<div
					data-testid="sidebar-footer"
					className="flex h-12 shrink-0 items-center gap-2 border-t-[0.5px] border-border p-2"
				>
					<span className="flex h-8 min-w-0 items-center gap-2 px-1">
						<span className={`size-6 rounded-full ${BAR_CLASS}`} />
						<span className={`h-3 w-24 ${BAR_CLASS}`} />
					</span>
				</div>
			</div>

			<div className="flex min-w-0 flex-1 flex-col bg-surface-2">
				{pathname === "/artifacts" ? (
					<ArtifactsSkeleton />
				) : pathname === "/" ? (
					// The loaded home page's tile shell, so the titlebar does not jump on hydration.
					<div data-route-tile-shell="home">
						<div className="min-h-0 flex-1">
							<HomeSkeleton chin={labels} />
						</div>
					</div>
				) : (
					// The loaded session's tile shell, chat tile and footer, so the composer lands where it hydrates.
					<div data-route-tile-shell="session">
						<div className="min-h-0 flex-1">
							<div className={SESSION_TILE_CLASS}>
								<div className="min-h-0 flex-1 overflow-hidden">
									<SessionSkeleton />
								</div>
								<div className={SESSION_FOOTER_CLASS}>
									<div className="pt-2">
										<div className={SESSION_DOCK_COLUMN_CLASS}>
											<FallbackComposer placeholder="Type / for commands" chin={labels} />
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
