import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { syncUnseenFromSummaries } from "./unread-store";

interface UnseenFlag {
  id: string;
  unseen: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flagsFromList(value: unknown, idKey: "id" | "sessionId"): UnseenFlag[] {
  if (!Array.isArray(value)) return [];
  const flags: UnseenFlag[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = item[idKey];
    const unseen = item["unseen"];
    if (typeof id === "string" && typeof unseen === "boolean") flags.push({ id, unseen });
  }
  return flags;
}

/**
 * Pull the server's `unseen` flags out of a session list query's data: the
 * recent feed (single page or infinite), the per-project groups, id lookups (pins), and
 * the active list. Other queries carry no summary flags.
 */
export function unseenFlagsFromSessionQuery(queryKey: QueryKey, data: unknown): UnseenFlag[] {
  if (queryKey[0] !== "sessions") return [];
  switch (queryKey[1]) {
    case "recent": {
      if (!isRecord(data)) return [];
      const pages = Array.isArray(data["pages"]) ? data["pages"] : [data];
      return pages.flatMap((page) => (isRecord(page) ? flagsFromList(page["sessions"], "id") : []));
    }
    case "grouped":
      return Array.isArray(data)
        ? data.flatMap((group) => (isRecord(group) ? flagsFromList(group["sessions"], "id") : []))
        : [];
    case "by-ids":
      return flagsFromList(data, "id");
    case "active":
      return flagsFromList(data, "sessionId");
    default:
      return [];
  }
}

/**
 * Seed the unread cache from every session list already in the query cache
 * (including SSR-hydrated data), then from each fresh fetch. Manual cache
 * patches are skipped: SSE handlers sync those summaries directly.
 */
export function syncUnseenFromQueryCache(queryClient: QueryClient): () => void {
  const cache = queryClient.getQueryCache();
  for (const query of cache.getAll()) {
    syncUnseenFromSummaries(unseenFlagsFromSessionQuery(query.queryKey, query.state.data));
  }
  return cache.subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || event.action.manual) {
      return;
    }
    syncUnseenFromSummaries(unseenFlagsFromSessionQuery(event.query.queryKey, event.action.data));
  });
}
