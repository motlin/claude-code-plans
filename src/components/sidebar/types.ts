export type Section =
  | "active"
  | "herdr"
  | "tmux"
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
