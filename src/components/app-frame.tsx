import {useCallback, useRef, useState, type ReactNode} from "react";
import {topLeftClearanceStyle} from "../lib/top-left-clearance";
import {useNarrowViewport} from "../lib/sidebar-store";
import {usePhoneSheet} from "../lib/use-phone-sheet";
import {DensityProvider, useScopeDensity} from "./ui/density";
import {Sidebar, SidebarEdgeHandle} from "./sidebar/index";
import {PHONE_SHEET_TRANSITION_MS, PhoneSheet, PhoneSheetTrigger} from "./sidebar/phone-sheet";

/**
 * The app's sidebar + main split. Below 640px it follows claude.ai/code's phone layout: the
 * root carries `data-phone-sheet="left"`, a floating trigger opens the sidebar as a
 * full-screen sheet, and <main> is inert while the sheet is open. From 640px up to upstream's
 * width-aware threshold (≤700px at the default 288px width, ≤749px at 420) the sidebar is forced
 * collapsed (trigger + hover peek) without changing the persisted preference.
 */
export function AppFrame({
	collapsed,
	className,
	tileShell = false,
	children,
}: Readonly<{collapsed: boolean; className?: string; tileShell?: boolean; children: ReactNode}>) {
	const phoneSheet = usePhoneSheet();
	const narrowViewport = useNarrowViewport();
	const [sheetOpen, setSheetOpen] = useState(false);
	const openSheet = useCallback(() => {
		setSheetOpen(true);
	}, []);
	const closeSheet = useCallback(() => {
		setSheetOpen(false);
	}, []);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const dismissSheet = useCallback(() => {
		setSheetOpen(false);
		window.setTimeout(() => triggerRef.current?.focus(), PHONE_SHEET_TRANSITION_MS);
	}, []);
	const mainInert = phoneSheet && sheetOpen;
	const mainDensity = useScopeDensity("compact");
	const sidebarLayout = phoneSheet ? "phone" : collapsed || narrowViewport ? "collapsed" : "docked";

	return (
		<div
			data-testid="app-frame"
			data-phone-sheet={phoneSheet ? "left" : undefined}
			className="relative flex h-[var(--app-visual-viewport-height,100dvh)]"
		>
			{collapsed && !narrowViewport && !phoneSheet && <SidebarEdgeHandle />}
			{phoneSheet ? (
				<>
					<PhoneSheetTrigger ref={triggerRef} open={sheetOpen} onOpen={openSheet} />
					<PhoneSheet open={sheetOpen} onClose={closeSheet} onDismiss={dismissSheet} />
				</>
			) : (
				<Sidebar collapsed={collapsed || narrowViewport} narrowViewport={narrowViewport} />
			)}
			<main
				data-scroll-restoration-id={tileShell ? undefined : "main"}
				data-focus-region="main"
				data-perf-region="main"
				inert={mainInert}
				style={topLeftClearanceStyle(sidebarLayout)}
				data-density={mainDensity}
				className={`relative flex-1 bg-page text-body text-primary break-words ${tileShell ? "flex min-h-0 min-w-0 flex-col overflow-hidden" : "overflow-y-auto"} ${className ?? ""}`}
			>
				<DensityProvider density={mainDensity}>{children}</DensityProvider>
			</main>
		</div>
	);
}
