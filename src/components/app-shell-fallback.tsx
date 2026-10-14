import {Ellipsis, Plus, Search} from "lucide-react";
import {useEffect, useState} from "react";
import {DEFAULT_VISIBLE_NAV_SECTIONS} from "../lib/nav-sections";
import {DEFAULT_SIDEBAR_STATE} from "../lib/sidebar-store";
import {getVisibleNavItems, navItems} from "./sidebar/navigation";
import {SidebarToggleIcon} from "./sidebar/primitives";
import {ROW_CLASS as SESSION_ROW_CLASS} from "./sidebar/session-group-section";
import {SessionSkeleton} from "./session-skeleton";
import {HomeGreeting} from "./home/greeting";
import {HOME_COLUMN} from "./home/home-column";

const NAV_ROW_CLASS = "df-nav-row h-[var(--sb-row-h)] rounded-[var(--sb-radius)] flex-1";
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

/** Upstream draws its composer while loading: the 40px box with the placeholder, over the chin. */
function FallbackComposer({placeholder}: {placeholder: string}) {
	return (
		<div data-cds="ChatComposer" className="flex w-full min-w-0 flex-col font-sans">
			<div
				data-fallback-composer=""
				className="relative flex flex-col rounded-card bg-surface-3 p-2 shadow-[var(--composer-shadow-idle)]"
			>
				<span className="block py-0.5 pl-1 text-[14px]/[20px] text-[rgb(137,135,129)]">{placeholder}</span>
			</div>
			<div
				data-cds="ChatComposerChin"
				className="mt-1.5 flex min-h-5 items-center ps-[7px] pe-2.5 text-[12px]/[15px] text-secondary"
			>
				<Plus aria-hidden="true" className="size-4" />
			</div>
		</div>
	);
}

/**
 * The artifacts page while it loads, in its own layout: the root's top row and gutter, the compact
 * header's title and tab row, then a card grid like the loaded page's.
 */
function ArtifactsSkeleton() {
	return (
		<div data-testid="artifacts-skeleton" className="min-h-0 flex-1 overflow-hidden">
			<div className="min-h-9" />
			<div className="px-4 sm:px-8">
				<div className="mx-auto -mt-1 flex w-full max-w-5xl flex-col">
					<span className={`h-8 w-36 ${BAR_CLASS}`} />
					<div className="mt-5 flex h-8 items-center gap-2">
						<span className={`h-6 w-10 ${BAR_CLASS}`} />
						<span className={`h-6 w-12 ${BAR_CLASS}`} />
						<span className={`h-6 w-28 ${BAR_CLASS}`} />
						<span className="ms-auto flex gap-2">
							{[0, 1, 2].map((index) => (
								<span key={index} className={`size-6 ${BAR_CLASS}`} />
							))}
						</span>
					</div>
					<div
						data-artifacts-skeleton-grid=""
						className="grid grid-cols-1 gap-6 pt-5 sm:grid-cols-2 md:grid-cols-3"
					>
						{[0, 1, 2, 3, 4, 5].map((index) => (
							<div
								key={index}
								data-artifacts-skeleton-card=""
								className="flex h-[252px] flex-col overflow-hidden rounded-card border border-border"
							>
								<span className="h-[160px] shrink-0 animate-pulse bg-fill-ghost-hover" />
								<span className={`m-3 h-4 w-3/4 ${BAR_CLASS}`} />
								<span className={`mx-3 h-3 w-1/3 ${BAR_CLASS}`} />
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

/** The home page while it loads, in its own layout: greeting, Sessions rows and the home composer. */
function HomeSkeleton() {
	return (
		<div data-testid="home-skeleton" className="flex h-full min-h-0 flex-col">
			<header className={`flex items-center gap-1.5 pt-3 pb-6 ${HOME_COLUMN}`}>
				<HomeGreeting name={undefined} clear={false} />
			</header>
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
			<div className={`shrink-0 pb-4 ${HOME_COLUMN}`}>
				<FallbackComposer placeholder="Describe a task or ask a question" />
			</div>
		</div>
	);
}

const HOME_ROW_WIDTHS = ["w-1/2", "w-2/5", "w-3/5", "w-1/3", "w-5/12"];

export function AppShellFallback({pathname = ""}: {pathname?: string}) {
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		setHydrated(true);
	}, []);

	if (hydrated) return null;

	return (
		<div id="app-shell-fallback" data-testid="app-shell-fallback" aria-hidden="true" className="flex h-screen">
			<div
				aria-label="Sidebar"
				style={{"--sidebar-width": `${DEFAULT_SIDEBAR_STATE.width}px`}}
				className="relative hidden h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r-[0.5px] border-border bg-[var(--sb-bg)] md:flex"
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
					className="flex h-12 shrink-0 items-center justify-between gap-2 border-t-[0.5px] border-border p-2"
				>
					<span className="flex h-8 min-w-0 items-center gap-2 px-1">
						<span className={`size-6 rounded-full ${BAR_CLASS}`} />
						<span className={`h-3 w-24 ${BAR_CLASS}`} />
					</span>
					<span className="flex h-8 w-8 items-center justify-center text-secondary">
						<Search className="h-4 w-4" aria-hidden="true" />
					</span>
				</div>
			</div>

			<div className="flex min-w-0 flex-1 flex-col bg-surface-2">
				{pathname === "/artifacts" ? (
					<ArtifactsSkeleton />
				) : pathname === "/" ? (
					// The loaded home page's tile shell and title-bar spacer, so the greeting does not jump on hydration.
					<div data-route-tile-shell="home">
						<div aria-hidden className="h-9 shrink-0 sm:h-8" />
						<div className="min-h-0 flex-1">
							<HomeSkeleton />
						</div>
					</div>
				) : (
					<>
						{/* The in-app session skeleton, in the tile shell it paints in, so both loads look alike. */}
						<div data-route-tile-shell="" className="overflow-hidden">
							<SessionSkeleton />
						</div>
						<div className="chat-column shrink-0 pb-4">
							<FallbackComposer placeholder="Type / for commands" />
						</div>
					</>
				)}
			</div>
		</div>
	);
}
