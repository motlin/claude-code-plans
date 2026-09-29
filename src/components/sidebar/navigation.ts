import {
  FileJson,
  Shapes,
  FileText,
  Brain,
  MessageSquare,
  FolderOpen,
  Star,
  Radio,
  SquareTerminal,
  Inbox,
  Bell,
  Settings,
  ListTodo,
  SlidersHorizontal,
  SlidersVertical,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { applicationSettingsQueryOptions } from "../../lib/api/application-settings";
import { DEFAULT_VISIBLE_NAV_SECTIONS, type NavSection } from "../../lib/nav-sections";
import type { Section } from "./types";

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Single source of truth for top-level navigation. Keyed by `Section` with
 * `satisfies Record<Section, NavEntry>` so adding a section without a nav
 * entry (or vice versa) is a compile error — the sidebar, its More menu and the
 * app-shell fallback all derive from `navItems` and cannot drift apart.
 */
const navEntries = {
  artifacts: {
    to: "/artifacts",
    label: "Artifacts",
    icon: Shapes,
  },
  active: {
    to: "/active",
    label: "Active",
    icon: Radio,
  },
  herdr: {
    to: "/herdr",
    label: "Herdr",
    icon: SquareTerminal,
  },
  tmux: {
    to: "/tmux",
    label: "Tmux Windows",
    icon: SquareTerminal,
  },
  approvals: {
    to: "/approvals",
    label: "Approvals",
    icon: Inbox,
  },
  notifications: {
    to: "/notifications",
    label: "Notifications",
    icon: Bell,
  },
  starred: {
    to: "/starred",
    label: "Starred",
    icon: Star,
  },
  tasks: {
    to: "/tasks",
    label: "Tasks",
    icon: ListTodo,
  },
  projects: {
    to: "/projects",
    label: "Projects",
    icon: FolderOpen,
  },
  plans: {
    to: "/plans",
    label: "Plans",
    icon: FileText,
  },
  memories: {
    to: "/memories",
    label: "Memories",
    icon: Brain,
  },
  sessions: {
    to: "/sessions",
    label: "Sessions",
    icon: MessageSquare,
  },
  customize: {
    to: "/customize",
    label: "Customize",
    icon: SlidersVertical,
  },
  settings: {
    to: "/settings",
    label: "Settings",
    icon: SlidersHorizontal,
  },
  config: {
    to: "/settings/edit",
    label: "Claude Config",
    icon: FileJson,
  },
  setup: {
    to: "/setup",
    label: "Setup",
    icon: Settings,
  },
} satisfies Record<Section, NavEntry>;

export const navItems = (Object.keys(navEntries) as Section[]).map((section) => ({
  section,
  ...(navEntries[section] as NavEntry),
}));

export type NavItem = (typeof navItems)[number];

/**
 * Split the nav into sidebar rows and the More ▸ overflow, both in nav order. The session list is
 * always pinned because it is not toggleable.
 */
export function getVisibleNavItems<T extends { section: Section }>(
  all: readonly T[],
  visible: readonly NavSection[],
): { pinned: T[]; overflow: T[] } {
  const visibleSet = new Set<Section>(visible);
  const pinned: T[] = [];
  const overflow: T[] = [];
  for (const item of all) {
    if (item.section === "sessions" || visibleSet.has(item.section)) pinned.push(item);
    else overflow.push(item);
  }
  return { pinned, overflow };
}

export function useVisibleNavItems() {
  const applicationSettings = useQuery(applicationSettingsQueryOptions);
  const visibleNavSections =
    applicationSettings.data?.visibleNavSections ?? DEFAULT_VISIBLE_NAV_SECTIONS;

  return useMemo(
    () => ({ ...getVisibleNavItems(navItems, visibleNavSections), visibleNavSections }),
    [visibleNavSections],
  );
}
