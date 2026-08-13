import type { useMatches } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { fromMdSlug } from "../../lib/md-slug";
import type { Section } from "./types";

function useGroupIdSet(): {
  ids: ReadonlySet<string>;
  toggle: (groupId: string) => void;
  add: (groupId: string) => void;
  remove: (groupId: string) => void;
} {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((groupId: string) => {
    setIds((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const add = useCallback((groupId: string) => {
    setIds((previous) => (previous.has(groupId) ? previous : new Set(previous).add(groupId)));
  }, []);

  const remove = useCallback((groupId: string) => {
    setIds((previous) => {
      if (!previous.has(groupId)) return previous;
      const next = new Set(previous);
      next.delete(groupId);
      return next;
    });
  }, []);

  return { ids, toggle, add, remove };
}

/**
 * Set of collapsed group ids, its toggle, and an idempotent reveal for groups
 * that open themselves (the one holding the item being viewed). Sublists unmount
 * whenever their section collapses, so this has to be owned by the sidebar
 * itself — state held inside a sublist would come back expand-all'd after every
 * navigation.
 *
 * Reveal drops the group from the set once instead of forcing it expanded on
 * every render: a derived reveal would leave the chevron of the group you are
 * looking at inert, which reads as a broken control.
 */
export function useCollapsedGroups(): [
  ReadonlySet<string>,
  (groupId: string) => void,
  (groupId: string) => void,
] {
  const { ids, toggle, remove } = useGroupIdSet();
  return [ids, toggle, remove];
}

/**
 * Set of expanded group ids, its toggle, and an idempotent expand for groups
 * that open themselves (the project being viewed). Owned by the sidebar for the
 * same reason as useCollapsedGroups: state held inside a sublist would come back
 * collapse-all'd after every navigation.
 */
export function useExpandedGroups(): [
  ReadonlySet<string>,
  (groupId: string) => void,
  (groupId: string) => void,
] {
  const { ids, toggle, add } = useGroupIdSet();
  return [ids, toggle, add];
}

export function useActiveSection(matches: ReturnType<typeof useMatches>): {
  section: Section | null;
  activeItemId: string | null;
} {
  const lastMatch = matches[matches.length - 1];
  const path = lastMatch?.fullPath ?? "/";
  const params = lastMatch?.params as Record<string, string> | undefined;

  if (path.startsWith("/active")) {
    return { section: "active", activeItemId: null };
  }
  if (path.startsWith("/herdr")) {
    return { section: "herdr", activeItemId: params?.["sessionId"] ?? null };
  }
  if (path.startsWith("/tmux")) {
    return { section: "tmux", activeItemId: null };
  }
  if (path.startsWith("/approvals")) {
    return { section: "approvals", activeItemId: null };
  }
  if (path.startsWith("/starred")) {
    return { section: "starred", activeItemId: null };
  }
  if (path.startsWith("/tasks")) {
    return { section: "tasks", activeItemId: null };
  }
  if (path.startsWith("/project") && !path.startsWith("/projects")) {
    return { section: "projects", activeItemId: params?.["id"] ?? null };
  }
  if (path === "/projects") {
    return { section: "projects", activeItemId: null };
  }
  if (path.startsWith("/plan") || path === "/plans") {
    return {
      section: "plans",
      activeItemId: params?.["filename"] ? fromMdSlug(params["filename"]) : null,
    };
  }
  if (path.startsWith("/memor") || path === "/memories") {
    return {
      section: "memories",
      activeItemId:
        params?.["project"] && params?.["filename"]
          ? `${params["project"]}/${fromMdSlug(params["filename"])}`
          : null,
    };
  }
  if (path.startsWith("/session") || path === "/sessions") {
    return { section: "sessions", activeItemId: params?.["id"] ?? null };
  }
  if (path.startsWith("/plugin") || path === "/plugins" || path.startsWith("/command")) {
    return { section: "plugins", activeItemId: params?.["id"] ?? null };
  }
  if (path.startsWith("/settings/edit")) {
    return { section: "config", activeItemId: null };
  }
  if (path.startsWith("/settings")) {
    return { section: "settings", activeItemId: null };
  }
  if (path.startsWith("/setup")) {
    return { section: "setup", activeItemId: null };
  }
  return { section: null, activeItemId: null };
}
