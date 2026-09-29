import { z } from "zod";
import { toMdSlug } from "./md-slug";

/**
 * Per-tab most-recently-visited pages, the model behind the ⌃Q recents switcher. Mirrors
 * claude.ai/code's `cmdk-navigation-history`: move-to-front, dedupe by key, at most 30 entries,
 * persisted in sessionStorage so each tab keeps its own back-stack.
 */
export const RECENTS_HISTORY_STORAGE_KEY = "ccb-navigation-history";
export const RECENTS_HISTORY_MAX = 30;

const RECENT_KINDS = ["session", "subagents", "plan", "memory", "project", "command"] as const;

const RecentKindSchema = z.enum(RECENT_KINDS);
export type RecentKind = z.infer<typeof RecentKindSchema>;

const RecentEntrySchema = z.strictObject({
  key: z.string().min(1),
  kind: RecentKindSchema,
  href: z.string().startsWith("/"),
  title: z.string().optional(),
});

export const RecentsHistorySchema = z.array(RecentEntrySchema).max(RECENTS_HISTORY_MAX);

export type RecentEntry = z.infer<typeof RecentEntrySchema>;
export type RecentTarget = Omit<RecentEntry, "title">;

function target(kind: RecentKind, id: string, href: string): RecentTarget {
  return { key: `${kind}:${id}`, kind, href };
}

/** Maps a pathname to the recent-able page it shows, or null for pages that are not recorded. */
export function routeToRecent(pathname: string): RecentTarget | null {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const [section, first, second, third] = segments;
  if (first === undefined) return null;
  switch (section) {
    case "session":
      if (segments.length === 2) return target("session", first, `/session/${first}`);
      if (segments.length === 3 && second === "subagents") {
        return target("subagents", first, `/session/${first}/subagents`);
      }
      return null;
    case "plan": {
      if (segments.length !== 2) return null;
      const slug = toMdSlug(first);
      return target("plan", slug, `/plan/${slug}`);
    }
    case "memory":
    case "command": {
      if (second === undefined || third !== undefined) return null;
      const id = `${first}/${toMdSlug(second)}`;
      return target(section, id, `/${section}/${id}`);
    }
    case "project":
      return segments.length === 2 ? target("project", first, `/project/${first}`) : null;
    default:
      return null;
  }
}

/** Moves `entry` to the front, dropping any older entry with its key and capping at 30. */
export function push(entries: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] {
  const existing = entries.find((candidate) => candidate.key === entry.key);
  const merged =
    entry.title === undefined && existing?.title !== undefined
      ? { ...entry, title: existing.title }
      : entry;
  return [merged, ...entries.filter((candidate) => candidate.key !== entry.key)].slice(
    0,
    RECENTS_HISTORY_MAX,
  );
}

export function retitle(
  entries: readonly RecentEntry[],
  key: string,
  title: string,
): RecentEntry[] {
  return entries.map((entry) => (entry.key === key ? { ...entry, title } : entry));
}

export function remove(entries: readonly RecentEntry[], key: string): RecentEntry[] {
  return entries.filter((entry) => entry.key !== key);
}

function browserSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadRecents(storage: Storage | null = browserSessionStorage()): RecentEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENTS_HISTORY_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = RecentsHistorySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    // sessionStorage can be denied or hold corrupt JSON; the history is best-effort.
    return [];
  }
}

export function saveRecents(
  entries: readonly RecentEntry[],
  storage: Storage | null = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(RECENTS_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // sessionStorage can be denied or full; the history is best-effort.
  }
}
