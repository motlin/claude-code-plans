import {
  FileJson,
  FileText,
  Brain,
  MessageSquare,
  FolderOpen,
  Star,
  Radio,
  SquareTerminal,
  Inbox,
  Bell,
  Blocks,
  Settings,
  ListTodo,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { applicationSettingsQueryOptions } from "../../lib/api/application-settings";
import type { Section } from "./types";

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

/**
 * Single source of truth for top-level navigation. Keyed by `Section` with
 * `satisfies Record<Section, NavEntry>` so adding a section without a nav
 * entry (or vice versa) is a compile error — the sidebar and the home grid
 * both derive from `navItems` and cannot drift apart.
 */
const navEntries = {
  active: {
    to: "/active",
    label: "Active",
    icon: Radio,
    description: "Live sessions currently running",
  },
  herdr: {
    to: "/herdr",
    label: "Herdr",
    icon: SquareTerminal,
    description: "Live terminals managed by Herdr",
  },
  tmux: {
    to: "/tmux",
    label: "Tmux Windows",
    icon: SquareTerminal,
    description: "Open tmux windows running Claude Code",
  },
  approvals: {
    to: "/approvals",
    label: "Approvals",
    icon: Inbox,
    description: "Permission requests awaiting a decision",
  },
  notifications: {
    to: "/notifications",
    label: "Notifications",
    icon: Bell,
    description: "Notifications from Claude Code sessions",
  },
  starred: {
    to: "/starred",
    label: "Starred",
    icon: Star,
    description: "Sessions you have starred for quick access",
  },
  tasks: {
    to: "/tasks",
    label: "Tasks",
    icon: ListTodo,
    description: "Built-in tasks across all projects",
  },
  projects: {
    to: "/projects",
    label: "Projects",
    icon: FolderOpen,
    description: "View sessions, memories, and plans by project",
  },
  plans: {
    to: "/plans",
    label: "Plans",
    icon: FileText,
    description: "Browse Claude Code plan files",
  },
  memories: {
    to: "/memories",
    label: "Memories",
    icon: Brain,
    description: "Browse Claude Code memory files by project",
  },
  sessions: {
    to: "/sessions",
    label: "Sessions",
    icon: MessageSquare,
    description: "Browse Claude Code session files",
  },
  plugins: {
    to: "/plugins",
    label: "Plugins",
    icon: Blocks,
    description: "Browse installed plugins, skills, agents, and commands",
  },
  settings: {
    to: "/settings",
    label: "Settings",
    icon: SlidersHorizontal,
    description: "Configure display, appearance, and behavior",
  },
  config: {
    to: "/settings/edit",
    label: "Claude Config",
    icon: FileJson,
    description: "Edit Claude configuration files",
  },
  setup: {
    to: "/setup",
    label: "Setup",
    icon: Settings,
    description: "Configure hooks for live session tracking",
  },
} satisfies Record<Section, NavEntry>;

export const navItems = (Object.keys(navEntries) as Section[]).map((section) => ({
  section,
  ...(navEntries[section] as NavEntry),
}));

interface NavigationVisibilitySettings {
  showHerdrSection: boolean;
  showTmuxSection: boolean;
}

const DEFAULT_NAVIGATION_VISIBILITY = {
  showHerdrSection: true,
  showTmuxSection: false,
} satisfies NavigationVisibilitySettings;

export function getVisibleNavItems(
  settings: NavigationVisibilitySettings = DEFAULT_NAVIGATION_VISIBILITY,
) {
  return navItems.filter(
    (item) =>
      (item.section !== "herdr" || settings.showHerdrSection) &&
      (item.section !== "tmux" || settings.showTmuxSection),
  );
}

export function useVisibleNavItems() {
  const applicationSettings = useQuery(applicationSettingsQueryOptions);
  const showHerdrSection =
    applicationSettings.data?.showHerdrSection ?? DEFAULT_NAVIGATION_VISIBILITY.showHerdrSection;
  const showTmuxSection =
    applicationSettings.data?.showTmuxSection ?? DEFAULT_NAVIGATION_VISIBILITY.showTmuxSection;

  return useMemo(
    () => getVisibleNavItems({ showHerdrSection, showTmuxSection }),
    [showHerdrSection, showTmuxSection],
  );
}
