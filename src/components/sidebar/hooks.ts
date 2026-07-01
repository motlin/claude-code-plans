import type { useMatches } from "@tanstack/react-router";
import { fromMdSlug } from "../../lib/md-slug";
import type { Section } from "./types";

export function useActiveSection(matches: ReturnType<typeof useMatches>): {
  section: Section | null;
  activeItemId: string | null;
  projectId: string | null;
  collapseOthers: boolean;
} {
  const lastMatch = matches[matches.length - 1];
  const path = lastMatch?.fullPath ?? "/";
  const params = lastMatch?.params as Record<string, string> | undefined;

  if (path === "/") {
    return {
      section: null,
      activeItemId: null,
      projectId: null,
      collapseOthers: true,
    };
  }
  if (path.startsWith("/active")) {
    return {
      section: "active",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/tmux")) {
    return {
      section: "tmux",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/approvals")) {
    return {
      section: "approvals",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/starred")) {
    return {
      section: "starred",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/tasks")) {
    return {
      section: "tasks",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/project") && !path.startsWith("/projects")) {
    return {
      section: "projects",
      activeItemId: params?.["id"] ?? null,
      projectId: params?.["id"] ?? null,
      collapseOthers: false,
    };
  }
  if (path === "/projects") {
    return {
      section: "projects",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/plan") || path === "/plans") {
    return {
      section: "plans",
      activeItemId: params?.["filename"] ? fromMdSlug(params["filename"]) : null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/memor") || path === "/memories") {
    return {
      section: "memories",
      activeItemId:
        params?.["project"] && params?.["filename"]
          ? `${params["project"]}/${fromMdSlug(params["filename"])}`
          : null,
      projectId: params?.["project"] ?? null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/session") || path === "/sessions") {
    return {
      section: "sessions",
      activeItemId: params?.["id"] ?? null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/plugin") || path === "/plugins" || path.startsWith("/command")) {
    return {
      section: "plugins",
      activeItemId: params?.["id"] ?? null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/settings/edit")) {
    return {
      section: "config",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/settings")) {
    return {
      section: "settings",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  if (path.startsWith("/setup")) {
    return {
      section: "setup",
      activeItemId: null,
      projectId: null,
      collapseOthers: false,
    };
  }
  return {
    section: null,
    activeItemId: null,
    projectId: null,
    collapseOthers: false,
  };
}
