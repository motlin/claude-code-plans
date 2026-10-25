import {isSessionRouteAlias} from "./session-route-alias";
import {z} from "zod";
import {defined} from "./defined";
import {toMdSlug} from "./md-slug";

/**
 * Per-tab most-recently-visited pages, the model behind the ⌃Q recents switcher and the ⌘K Recents
 * group. Mirrors claude.ai/code's `cmdk-navigation-history`: move-to-front, dedupe by key, at most 30
 * switchable entries, persisted in sessionStorage so each tab keeps its own back-stack. The other page
 * kinds only feed the palette, so they get their own 30 and never crowd the switcher.
 */
export const RECENTS_HISTORY_STORAGE_KEY = "ccb-navigation-history";
export const RECENTS_HISTORY_MAX = 30;

const RECENT_KINDS = ["session", "subagents", "plan", "memory", "project", "command"] as const;

/** Upstream's switcher lists chats, code sessions, projects and artifacts; ours has sessions and projects. */
const SWITCHER_KINDS = ["session", "project"] as const satisfies readonly RecentKind[];
export type SwitcherKind = (typeof SWITCHER_KINDS)[number];
export type SwitcherEntry = RecentEntry & {kind: SwitcherKind};

function isSwitcherEntry(entry: RecentEntry): entry is SwitcherEntry {
	return (SWITCHER_KINDS as readonly RecentKind[]).includes(entry.kind);
}

const RecentKindSchema = z.enum(RECENT_KINDS);
export type RecentKind = z.infer<typeof RecentKindSchema>;

const RecentEntrySchema = z.strictObject({
	key: z.string().min(1),
	kind: RecentKindSchema,
	href: z.string().startsWith("/"),
	title: z.string().optional(),
});

export const RecentsHistorySchema = z.array(RecentEntrySchema).max(RECENTS_HISTORY_MAX * 2);

export type RecentEntry = z.infer<typeof RecentEntrySchema>;
export type RecentTarget = Omit<RecentEntry, "title">;

function target(kind: RecentKind, id: string, href: string): RecentTarget {
	return {key: `${kind}:${id}`, kind, href};
}

/** Maps a pathname to its recent page, optionally resolving a cached session identity. */
export function routeToRecent(pathname: string, resolveAlias?: (alias: string) => string | null): RecentTarget | null {
	const entry = parseRecentRoute(pathname);
	return entry === null || resolveAlias === undefined ? entry : resolveRecentSession(entry, resolveAlias);
}

function parseRecentRoute(pathname: string): RecentTarget | null {
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

/** Resolve one session without rebinding a known local owner to a saved alias's new owner. */
export function resolveRecentSession(entry: RecentEntry, resolveAlias: (alias: string) => string | null): RecentEntry {
	if (entry.kind !== "session" && entry.kind !== "subagents") return entry;
	const id = entry.key.slice(entry.kind.length + 1);
	const sessionId = isSessionRouteAlias(id) ? resolveAlias(id) : id;
	if (sessionId === null) return entry;
	const key = `${entry.kind}:${sessionId}`;
	const hrefTarget = routeToRecent(entry.href);
	const hrefId = hrefTarget?.key.slice(hrefTarget.kind.length + 1);
	const hrefOwner = hrefId !== undefined && isSessionRouteAlias(hrefId) ? resolveAlias(hrefId) : hrefId;
	const href =
		hrefTarget?.kind === entry.kind && hrefOwner === sessionId
			? entry.href
			: `/session/${sessionId}${entry.kind === "subagents" ? "/subagents" : ""}`;
	return {...entry, key, href};
}

/** Resolve session identities without changing the captured visit order or rebinding a known local owner. */
export function resolveRecentSessions(
	entries: readonly RecentEntry[],
	resolveAlias: (alias: string) => string | null,
): RecentEntry[] {
	const positions = new Map<string, number>();
	const result: RecentEntry[] = [];
	for (const entry of entries) {
		const resolved = resolveRecentSession(entry, resolveAlias);
		const previousIndex = positions.get(resolved.key);
		if (previousIndex !== undefined) {
			const previous = defined(result[previousIndex], "positions only holds indices already pushed to result");
			if (previous.title === undefined && resolved.title !== undefined) {
				result[previousIndex] = {...previous, title: resolved.title};
			}
			continue;
		}
		positions.set(resolved.key, result.length);
		result.push(resolved);
	}
	return result;
}

/** The entries the ⌃Q switcher lists, in visit order. */
export function switcherRecents(entries: readonly RecentEntry[]): SwitcherEntry[] {
	return entries.filter(isSwitcherEntry);
}

/** Moves `entry` to the front, dropping any older entry with its key; keeps 30 switchable and 30 other pages. */
export function push(entries: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] {
	const existing = entries.find((candidate) => candidate.key === entry.key);
	const merged =
		entry.title === undefined && existing?.title !== undefined ? {...entry, title: existing.title} : entry;
	let switchable = 0;
	let other = 0;
	return [merged, ...entries.filter((candidate) => candidate.key !== entry.key)].filter((candidate) =>
		isSwitcherEntry(candidate) ? ++switchable <= RECENTS_HISTORY_MAX : ++other <= RECENTS_HISTORY_MAX,
	);
}

export function retitle(entries: readonly RecentEntry[], key: string, title: string): RecentEntry[] {
	return entries.map((entry) => (entry.key === key ? {...entry, title} : entry));
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

export function saveRecents(entries: readonly RecentEntry[], storage: Storage | null = browserSessionStorage()): void {
	if (!storage) return;
	try {
		storage.setItem(RECENTS_HISTORY_STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// sessionStorage can be denied or full; the history is best-effort.
	}
}
