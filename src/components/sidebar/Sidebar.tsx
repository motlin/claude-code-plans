import { Link, useMatches } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { Section } from "./types";
import { useActiveSection, useCollapsedGroups, useExpandedGroups } from "./hooks";
import { useVisibleNavItems } from "./navigation";
import { SearchInput } from "./primitives";
import { NavScroll } from "./nav-scroll";
import { SidebarToggleButton } from "./sidebar-toggle";
import {
  ActiveSubList,
  MemoriesSubList,
  PlansSubList,
  ProjectsSubList,
  PluginsSubList,
  SessionsSubList,
} from "./sublists";
import { approvalsQueryOptions } from "../../lib/api/approvals";
import { notificationsQueryOptions, useMarkNotificationsRead } from "../../lib/api/notifications";
import { activeSessionsQueryOptions } from "../../lib/api/sessions";
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
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.fullPath ?? "/";
  const { section: activeSection, activeItemId } = useActiveSection(matches);
  const navigationItems = useVisibleNavItems();
  const [collapsedSections, setCollapsedSections] = useState<Set<Section>>(
    () => new Set(navigationItems.map((item) => item.section)),
  );
  // Sublists unmount whenever their section collapses, so per-group collapse
  // state has to be held here, in the sidebar that outlives every navigation.
  const [collapsedMemoryGroups, toggleMemoryGroup, revealMemoryGroup] = useCollapsedGroups();
  const [collapsedSessionGroups, toggleSessionGroup, revealSessionGroup] = useCollapsedGroups();
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

  if (collapsed && !mobile) {
    return (
      <div className="absolute left-2 top-2 z-10 hidden md:block">
        <SidebarToggleButton />
      </div>
    );
  }

  return (
    <nav
      aria-label="Sidebar"
      className={
        mobile
          ? "group/sidebar relative flex h-full w-[288px] shrink-0 flex-col border-r-[0.5px] border-border bg-surface-0"
          : "group/sidebar relative hidden h-full w-[288px] shrink-0 flex-col border-r-[0.5px] border-border bg-surface-0 md:flex"
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

      <SearchInput />

      <div className="flex min-h-0 flex-1 flex-col px-2">
        <div className="shrink-0">
          {navigationItems.map((item) => {
            const isActive =
              item.to === "/settings"
                ? currentPath === "/settings"
                : currentPath.startsWith(item.to);
            const Icon = item.icon;
            const isExpanded = !collapsedSections.has(item.section);
            const badge =
              item.section === "active"
                ? { count: activeCount, title: `${activeCount} active` }
                : item.section === "approvals"
                  ? { count: approvalsCount, title: `${approvalsCount} awaiting approval` }
                  : item.section === "notifications"
                    ? { count: unreadCount, title: `${unreadCount} unread` }
                    : null;
            return (
              <div key={item.to} className="flex items-center">
                <button
                  type="button"
                  onClick={() => toggleSection(item.section)}
                  className="flex h-8 w-6 shrink-0 items-center justify-center text-t6 transition-colors hover:text-secondary"
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
                  className={`mb-0.5 flex h-8 flex-1 items-center gap-2 rounded-r5 px-2 py-1.5 text-xs no-underline transition-colors ${
                    isActive
                      ? "bg-fill-ghost-hover font-medium text-primary"
                      : "text-secondary hover:bg-fill-ghost-hover"
                  }`}
                  style={{
                    fontWeight: isActive ? 500 : 430,
                    lineHeight: "16px",
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {badge && badge.count > 0 && (
                    <span
                      className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white"
                      title={badge.title}
                    >
                      {badge.count}
                    </span>
                  )}
                </Link>
              </div>
            );
          })}
          <div className="h-1 shrink-0" />
        </div>
        <NavScroll>
          {navigationItems.map((item) => {
            if (collapsedSections.has(item.section)) return null;
            const subList =
              item.section === "active" ? (
                <ActiveSubList />
              ) : item.section === "projects" ? (
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
              ) : item.section === "sessions" ? (
                <SessionsSubList
                  activeItemId={activeItemId}
                  collapsedGroups={collapsedSessionGroups}
                  onToggleGroup={toggleSessionGroup}
                  onRevealGroup={revealSessionGroup}
                />
              ) : null;
            return subList && <div key={item.to}>{subList}</div>;
          })}
        </NavScroll>
      </div>
    </nav>
  );
}
