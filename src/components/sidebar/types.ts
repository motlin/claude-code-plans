export type Section =
  | "active"
  | "tmux"
  | "fleet"
  | "approvals"
  | "notifications"
  | "starred"
  | "tasks"
  | "projects"
  | "plans"
  | "memories"
  | "sessions"
  | "plugins"
  | "settings"
  | "config"
  | "setup";

export interface SubItem {
  id: string;
  label: string;
  to: string;
  params: Record<string, string>;
}

export interface SidebarProjectDetail {
  sessions: Array<{
    id: string;
    title: string;
    gitBranch?: string | undefined;
  }>;
  plans: Array<{ filename: string; title: string }>;
  memories: Array<{ filename: string; title: string; project: string }>;
  todoCounts: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
  };
}
