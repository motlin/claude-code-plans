import { useCallback, useState, type ReactNode } from "react";
import { usePhoneSheet } from "../lib/use-phone-sheet";
import { Sidebar } from "./sidebar/index";
import { PhoneSheet, PhoneSheetTrigger } from "./sidebar/phone-sheet";

/**
 * The app's sidebar + main split. Below 640px it follows claude.ai/code's phone layout: the
 * root carries `data-phone-sheet="left"`, a floating trigger opens the sidebar as a
 * full-screen sheet, and <main> is inert while the sheet is open.
 */
export function AppFrame({
  collapsed,
  className,
  children,
}: Readonly<{ collapsed: boolean; className?: string; children: ReactNode }>) {
  const phoneSheet = usePhoneSheet();
  const [sheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const mainInert = phoneSheet && sheetOpen;

  return (
    <div
      data-testid="app-frame"
      data-phone-sheet={phoneSheet ? "left" : undefined}
      className="flex h-screen"
    >
      {phoneSheet ? (
        <>
          <PhoneSheetTrigger open={sheetOpen} onOpen={openSheet} />
          <PhoneSheet open={sheetOpen} onClose={closeSheet} />
        </>
      ) : (
        <Sidebar collapsed={collapsed} />
      )}
      <main
        data-scroll-restoration-id="main"
        data-focus-region="main"
        inert={mainInert}
        className={`flex-1 overflow-y-auto bg-surface-2 ${className ?? ""}`}
      >
        {children}
      </main>
    </div>
  );
}
