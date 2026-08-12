import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { getVisibleNavItems } from "./sidebar/navigation";

const CONTENT_PLACEHOLDER_WIDTHS = ["w-1/3", "w-full", "w-5/6", "w-2/3", "w-3/4", "w-1/2"];

/**
 * Static app frame painted from the server response.
 *
 * The root route sets `ssr: false`, so no route renders any HTML on the server
 * and the client cannot paint until the bundle downloads, parses and hydrates.
 * This component lives in `shellComponent`, which does render on the server, so
 * a hard load shows the sidebar, header and a content skeleton immediately
 * instead of a blank white frame. It removes itself on hydration, at which
 * point the real `RootLayout` is already mounted underneath it.
 */
export function AppShellFallback() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (hydrated) return null;

  return (
    <div
      id="app-shell-fallback"
      data-testid="app-shell-fallback"
      aria-hidden="true"
      className="flex h-screen"
    >
      <div
        aria-label="Sidebar"
        className="relative hidden h-full w-[288px] shrink-0 flex-col border-r-[0.5px] border-border-300/15 bg-bg-200 md:flex"
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-3">
          <span className="flex items-center gap-2.5 text-base font-bold text-text-000">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#C87B3A]">
              <svg viewBox="0 0 32 32" className="h-4 w-4">
                <path
                  d="M16 5L17.5 13.5L26 16L17.5 18.5L16 27L14.5 18.5L6 16L14.5 13.5Z"
                  fill="white"
                  opacity="0.95"
                />
              </svg>
            </span>
            Claude Code Browser
          </span>
        </div>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-500" />
            <div className="w-full rounded-md border border-border-300/10 bg-bg-000/50 py-1.5 pl-7 pr-2 text-xs text-text-500">
              Search...
            </div>
          </div>
        </div>

        <div className="flex-1 px-2">
          {getVisibleNavItems().map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.to} className="flex items-center">
                <span className="h-8 w-6 shrink-0" />
                <span
                  className="mb-0.5 flex h-8 flex-1 items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs text-text-200"
                  style={{ fontWeight: 430, lineHeight: "16px" }}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 bg-bg-000">
        <div className="min-h-9 px-4 pt-3 sm:px-8" />
        <div className="px-4 pb-24 sm:px-8 sm:pb-8">
          <div className="animate-pulse space-y-4 pt-4">
            {CONTENT_PLACEHOLDER_WIDTHS.map((width) => (
              <div key={width} className={`h-5 rounded bg-bg-300/50 ${width}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
