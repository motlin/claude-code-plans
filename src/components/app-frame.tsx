import {useCallback, useState, type ReactNode} from "react";
import {topLeftClearanceStyle} from "../lib/top-left-clearance";
import {useNarrowViewport, usePhoneSheet} from "../lib/use-phone-sheet";
import {Sidebar} from "./sidebar/index";
import {PhoneSheet, PhoneSheetTrigger} from "./sidebar/phone-sheet";

/**
 * The app's sidebar + main split. Below 640px it follows claude.ai/code's phone layout: the
 * root carries `data-phone-sheet="left"`, a floating trigger opens the sidebar as a
 * full-screen sheet, and <main> is inert while the sheet is open. From 640 to 767px the sidebar
 * is forced collapsed (trigger + hover peek) without changing the persisted preference.
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
	const openSheet = useCallback(() => setSheetOpen(true), []);
	const closeSheet = useCallback(() => setSheetOpen(false), []);
	const mainInert = phoneSheet && sheetOpen;
	const sidebarLayout = phoneSheet ? "phone" : collapsed || narrowViewport ? "collapsed" : "docked";

	return (
		<div data-testid="app-frame" data-phone-sheet={phoneSheet ? "left" : undefined} className="flex h-screen">
			{phoneSheet ? (
				<>
					<PhoneSheetTrigger open={sheetOpen} onOpen={openSheet} />
					<PhoneSheet open={sheetOpen} onClose={closeSheet} />
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
				className={`flex-1 bg-page dark:bg-surface-2 ${tileShell ? "flex min-h-0 min-w-0 flex-col overflow-hidden" : "overflow-y-auto"} ${className ?? ""}`}
			>
				{children}
			</main>
		</div>
	);
}
