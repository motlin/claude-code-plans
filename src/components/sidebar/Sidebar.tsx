import { Link, useMatches } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Section } from "./types";
import { useActiveSection, useCollapsedGroups, useExpandedGroups } from "./hooks";
import { MoreNavMenu, type NavBadge } from "./more-menu";
import { useVisibleNavItems } from "./navigation";
import { NavScroll } from "./nav-scroll";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarToggleButton } from "./sidebar-toggle";
import { SidebarSessionGroups } from "./session-filter-menu";
import { MemoriesSubList, PlansSubList, ProjectsSubList, PluginsSubList } from "./sublists";
import { approvalsQueryOptions } from "../../lib/api/approvals";
import { notificationsQueryOptions, useMarkNotificationsRead } from "../../lib/api/notifications";
import { activeSessionsQueryOptions } from "../../lib/api/sessions";
import {
  setSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RESIZE_STEP,
  useSidebarState,
} from "../../lib/sidebar-store";
import { useResizableWidth } from "../../hooks/use-resizable-width";
import { useSettings } from "../settings-provider";

export function Sidebar({
  collapsed,
  onToggle,
  mobile,
}: {
  collapsed: boolean;
  /** Overrides the persisted toggle, e.g. to close the mobile drawer. */
  onToggle?: () => void;
  mobile?: boolean;
}) {
  const { width } = useSidebarState();
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.fullPath ?? "/";
  const { section: activeSection, activeItemId } = useActiveSection(matches);
  const {
    pinned: navigationItems,
    overflow: overflowItems,
    visibleNavSections,
  } = useVisibleNavItems();
  const [collapsedSections, setCollapsedSections] = useState<Set<Section>>(
    () => new Set(navigationItems.map((item) => item.section)),
  );
  // Sublists unmount whenever their section collapses, so per-group collapse
  // state has to be held here, in the sidebar that outlives every navigation.
  const [collapsedMemoryGroups, toggleMemoryGroup, revealMemoryGroup] = useCollapsedGroups();
  const [expandedProjects, toggleProject, expandProject] = useExpandedGroups();
  const { data: approvalsData } = useQuery(approvalsQueryOptions());
  const approvalsCount = approvalsData?.approvals.length ?? 0;
  const { data: notificationsData } = useQuery(notificationsQueryOptions());
  const unreadCount =
    notificationsData?.notifications.filter((notification) => notification.unread).length ?? 0;
  const { mutate: markNotificationsRead } = useMarkNotificationsRead();
  const { settings } = useSettings();
  const { data: activeSessions } = useQuery(
    activeSessionsQueryOptions(settings.activeTimeoutSec * 1000),
  );
  const activeCount = activeSessions?.length ?? 0;

  function badgeFor(section: Section): NavBadge | null {
    if (section === "active") return { count: activeCount, title: `${activeCount} active` };
    if (section === "approvals") {
      return { count: approvalsCount, title: `${approvalsCount} awaiting approval` };
    }
    if (section === "notifications") return { count: unreadCount, title: `${unreadCount} unread` };
    return null;
  }

  useEffect(() => {
    if (!currentPath.startsWith("/notifications") || unreadCount === 0) return;
    markNotificationsRead();
  }, [currentPath, unreadCount, markNotificationsRead]);

  function toggleSection(section: Section) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }

  // Auto-expand the active section and auto-collapse irrelevant sections when navigation changes
  useEffect(() => {
    if (!activeSection) return;

    setCollapsedSections((prev) => {
      const next = new Set(prev);

      // Expand the active section
      next.delete(activeSection);

      // Collapse sections that don't contain the current view when navigated to a
      // specific item.
      if (activeItemId) {
        for (const item of navigationItems) {
          if (item.section !== activeSection) {
            next.add(item.section);
          }
        }
      }

      return next;
    });
  }, [activeSection, activeItemId, navigationItems]);

  const body = (
    <>
      <div className="flex min-h-0 flex-1 flex-col px-2">
        <div className="shrink-0">
          {navigationItems.map((item) => {
            const isActive =
              item.to === "/settings"
                ? currentPath === "/settings"
                : currentPath.startsWith(item.to);
            const Icon = item.icon;
            const isExpanded = !collapsedSections.has(item.section);
            const badge = badgeFor(item.section);
            return (
              <div key={item.to} className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggleSection(item.section)}
                  className="flex h-[var(--sb-row-h)] w-6 shrink-0 items-center justify-center text-t6 transition-colors hover:text-secondary"
                  title={isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
                >
                  <ChevronRight
                    className="h-3 w-3 transition-transform duration-200"
                    style={{
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                  />
                </button>
                <Link
                  to={item.to}
                  data-selected={isActive ? "focused" : undefined}
                  className="group mb-[0.5px] flex h-[var(--sb-row-h)] min-w-0 flex-1 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] px-[var(--sb-row-px)] text-left text-[length:var(--sb-row-font)] leading-[1.5] text-secondary no-underline hover:bg-[var(--sb-hover)] focus-visible:bg-[var(--sb-hover)] data-[selected=focused]:bg-[var(--sb-selected)] data-[selected=focused]:text-primary [&_.df-leading-slot]:text-secondary"
                >
                  <span className="df-leading-slot">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {badge && badge.count > 0 && (
                    <span className="df-tail-mark">
                      <span
                        className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold text-white"
                        title={badge.title}
                      >
                        {badge.count}
                      </span>
                    </span>
                  )}
                </Link>
              </div>
            );
          })}
          <MoreNavMenu
            overflow={overflowItems}
            visibleNavSections={visibleNavSections}
            badgeFor={badgeFor}
          />
          <div className="h-1 shrink-0" />
        </div>
        <NavScroll>
          {navigationItems.map((item) => {
            if (collapsedSections.has(item.section)) return null;
            const subList =
              item.section === "projects" ? (
                <ProjectsSubList
                  activeItemId={activeItemId}
                  expandedProjects={expandedProjects}
                  onToggleProject={toggleProject}
                  onExpandProject={expandProject}
                />
              ) : item.section === "plans" ? (
                <PlansSubList activeItemId={activeItemId} />
              ) : item.section === "memories" ? (
                <MemoriesSubList
                  activeItemId={activeItemId}
                  collapsedGroups={collapsedMemoryGroups}
                  onToggleGroup={toggleMemoryGroup}
                  onRevealGroup={revealMemoryGroup}
                />
              ) : item.section === "plugins" ? (
                <PluginsSubList />
              ) : null;
            return subList && <div key={item.to}>{subList}</div>;
          })}
          <SidebarSessionGroups activeItemId={activeItemId} />
        </NavScroll>
      </div>
      <SidebarFooter />
    </>
  );

  if (collapsed && !mobile) {
    return <CollapsedSidebar>{body}</CollapsedSidebar>;
  }

  return (
    <nav
      aria-label="Sidebar"
      style={mobile ? undefined : ({ "--sidebar-width": `${width}px` } as CSSProperties)}
      className={
        mobile
          ? "group/sidebar relative flex h-full w-[288px] shrink-0 flex-col border-r-[0.5px] border-border bg-[var(--sb-bg)]"
          : "group/sidebar relative hidden h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r-[0.5px] border-border bg-[var(--sb-bg)] md:flex"
      }
    >
      <div data-testid="sidebar-titlebar" className="flex h-11 shrink-0 items-center px-2">
        <div className="flex w-8 shrink-0 justify-center">
          <div className="flex opacity-70 transition-opacity duration-[120ms] ease-[cubic-bezier(.32,.72,0,1)] group-hover/sidebar:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100">
            <SidebarToggleButton
              {...(onToggle ? { onClick: onToggle, collapsed: false } : {})}
              className="flex h-6 w-6 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover [&_svg]:h-4 [&_svg]:w-4"
            />
          </div>
        </div>
        <div className="ml-1.5 flex min-w-0 flex-col items-start">
          <Link
            to="/"
            className="font-voice text-[20px] leading-none font-medium whitespace-nowrap text-primary no-underline"
          >
            Claude Code Browser
          </Link>
        </div>
      </div>

      {body}
      {!mobile && <SidebarResizeHandle width={width} />}
    </nav>
  );
}

/**
 * Upstream's 12px `dframe-resize-handle` straddling the sidebar's right edge: its inner half is
 * clipped away unless focus-visible, and hovering reveals a 3x48 grip pill.
 */
function SidebarResizeHandle({ width }: { width: number }) {
  const handleProps = useResizableWidth({
    label: "Resize sidebar",
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    step: SIDEBAR_RESIZE_STEP,
    edge: "end",
    value: width,
    onChange: setSidebarWidth,
  });

  return (
    <div
      {...handleProps}
      className="group/resize absolute inset-y-0 end-[-6px] z-10 flex w-3 cursor-col-resize touch-none items-center justify-center [clip-path:inset(0_0_0_37.5%)] focus-visible:outline-none focus-visible:[clip-path:none]"
    >
      <span
        aria-hidden="true"
        className="h-12 w-[3px] rounded-full bg-border opacity-0 transition-opacity duration-[120ms] group-hover/resize:opacity-100 group-focus-visible/resize:bg-accent-100 group-focus-visible/resize:opacity-100"
      />
    </div>
  );
}

/**
 * Collapsed desktop sidebar, like claude.ai/code: a 32x32 floating trigger at 8,8 whose
 * hover (or the invisible bridge beneath it) reveals the full sidebar body as a popover.
 */
function CollapsedSidebar({ children }: { children: ReactNode }) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      data-testid="sidebar-collapsed"
      data-hovering={hovering ? "" : undefined}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      className="group/peek absolute left-2 top-2 z-50 hidden md:flex"
    >
      <div
        data-testid="sidebar-peek-bridge"
        aria-hidden="true"
        className="pointer-events-none absolute -left-2 top-0 h-10 w-[288px] group-data-[hovering]/peek:pointer-events-auto"
      />
      <SidebarToggleButton className="relative flex h-8 w-8 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover" />
      <nav
        data-testid="sidebar-peek"
        aria-label="Sidebar"
        aria-hidden={hovering ? undefined : true}
        inert={!hovering}
        className="pointer-events-none absolute top-[calc(100%+8px)] -left-0.5 flex max-h-[70vh] w-[288px] origin-top-left -translate-y-1.5 scale-[.98] flex-col overflow-hidden rounded-card bg-surface-popover pt-2 pb-3 opacity-0 shadow-pop sidebar-peek-motion group-data-[hovering]/peek:pointer-events-auto group-data-[hovering]/peek:translate-y-0 group-data-[hovering]/peek:scale-100 group-data-[hovering]/peek:opacity-100"
      >
        {children}
      </nav>
    </div>
  );
}
