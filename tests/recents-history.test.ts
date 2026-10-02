import {describe, expect, it} from "vite-plus/test";
import {
	RECENTS_HISTORY_MAX,
	RECENTS_HISTORY_STORAGE_KEY,
	type RecentEntry,
	loadRecents,
	push,
	remove,
	resolveRecentSessions,
	retitle,
	routeToRecent,
	saveRecents,
} from "../src/lib/recents-history";

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	get length(): number {
		return this.values.size;
	}
	clear(): void {
		this.values.clear();
	}
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class ThrowingStorage implements Storage {
	get length(): number {
		throw new Error("denied");
	}
	clear(): void {
		throw new Error("denied");
	}
	getItem(): string | null {
		throw new Error("denied");
	}
	key(): string | null {
		throw new Error("denied");
	}
	removeItem(): void {
		throw new Error("denied");
	}
	setItem(): void {
		throw new Error("denied");
	}
}

const session = (id: string, title?: string): RecentEntry => ({
	key: `session:${id}`,
	kind: "session",
	href: `/session/${id}`,
	...(title === undefined ? {} : {title}),
});

describe("routeToRecent", () => {
	it("optionally resolves session owners while retaining unknown aliases as navigation targets", () => {
		const resolveAlias = (alias: string) => (alias === "session_example" ? "alice" : null);
		expect([
			routeToRecent("/session/session_example", resolveAlias),
			routeToRecent("/session/session_example/subagents", resolveAlias),
			routeToRecent("/session/session_unknown", resolveAlias),
			routeToRecent("/session/alice", resolveAlias),
			routeToRecent("/plan/example", resolveAlias),
			routeToRecent("/settings", resolveAlias),
		]).toStrictEqual([
			{key: "session:alice", kind: "session", href: "/session/session_example"},
			{key: "subagents:alice", kind: "subagents", href: "/session/session_example/subagents"},
			{key: "session:session_unknown", kind: "session", href: "/session/session_unknown"},
			{key: "session:alice", kind: "session", href: "/session/alice"},
			{key: "plan:example", kind: "plan", href: "/plan/example"},
			null,
		]);
	});

	it.each([
		["/session/abc", {key: "session:abc", kind: "session", href: "/session/abc"}],
		["/session/abc/", {key: "session:abc", kind: "session", href: "/session/abc"}],
		["/session/abc/subagents", {key: "subagents:abc", kind: "subagents", href: "/session/abc/subagents"}],
		["/plan/my-plan", {key: "plan:my-plan", kind: "plan", href: "/plan/my-plan"}],
		["/plan/my-plan.md", {key: "plan:my-plan", kind: "plan", href: "/plan/my-plan"}],
		[
			"/memory/-Users-craig-proj/MEMORY",
			{
				key: "memory:-Users-craig-proj/MEMORY",
				kind: "memory",
				href: "/memory/-Users-craig-proj/MEMORY",
			},
		],
		[
			"/memory/-Users-craig-proj/MEMORY.md",
			{
				key: "memory:-Users-craig-proj/MEMORY",
				kind: "memory",
				href: "/memory/-Users-craig-proj/MEMORY",
			},
		],
		["/project/p1", {key: "project:p1", kind: "project", href: "/project/p1"}],
		["/command/user/do-task", {key: "command:user/do-task", kind: "command", href: "/command/user/do-task"}],
		["/command/user/do-task.md", {key: "command:user/do-task", kind: "command", href: "/command/user/do-task"}],
	])("records %s", (pathname, expected) => {
		expect(routeToRecent(pathname)).toEqual(expected);
	});

	it.each([
		"/",
		"",
		"/sessions",
		"/plans",
		"/projects",
		"/memories",
		"/settings",
		"/search",
		"/starred",
		"/pinned",
		"/tasks",
		"/herdr",
		"/herdr/terminal/abc",
		"/session",
		"/session/abc/source/uuid-1",
		"/session/abc/other",
		"/plan",
		"/plan/my-plan/edit",
		"/memory/proj",
		"/memory/proj/MEMORY/edit",
		"/project/p1/sessions",
		"/project/p1/plans",
		"/project/p1/memories",
		"/project/p1/subagents",
		"/project/p1/tasks",
		"/command/user",
		"/command/user/do-task/extra",
	])("does not record %s", (pathname) => {
		expect(routeToRecent(pathname)).toBeNull();
	});
});

describe("push", () => {
	it("adds a new entry to the front", () => {
		expect(push([session("a", "A")], session("b", "B"))).toEqual([session("b", "B"), session("a", "A")]);
	});

	it("moves an existing key to the front without duplicating it", () => {
		expect(push([session("c", "C"), session("b", "B"), session("a", "A")], session("a", "A2"))).toEqual([
			session("a", "A2"),
			session("c", "C"),
			session("b", "B"),
		]);
	});

	it("keeps the known title when the pushed entry has none", () => {
		expect(push([session("b", "B"), session("a", "A")], session("a"))).toEqual([
			session("a", "A"),
			session("b", "B"),
		]);
	});

	it("caps the history at 30 entries, dropping the oldest", () => {
		const entries = Array.from({length: RECENTS_HISTORY_MAX}, (_, index) => session(String(index)));
		const result = push(entries, session("new"));
		expect(RECENTS_HISTORY_MAX).toBe(30);
		expect(result).toEqual([session("new"), ...Array.from({length: 29}, (_, index) => session(String(index)))]);
	});

	it("does not mutate its input", () => {
		const entries = [session("a", "A")];
		push(entries, session("b"));
		expect(entries).toEqual([session("a", "A")]);
	});
});

describe("retitle", () => {
	it("sets the title of the matching entry only", () => {
		expect(retitle([session("b", "B"), session("a")], "session:a", "Alpha")).toEqual([
			session("b", "B"),
			session("a", "Alpha"),
		]);
	});

	it("returns the entries unchanged when the key is unknown", () => {
		expect(retitle([session("a", "A")], "session:z", "Zed")).toEqual([session("a", "A")]);
	});
});

describe("remove", () => {
	it("drops the matching entry", () => {
		expect(remove([session("b"), session("a"), session("c")], "session:a")).toEqual([session("b"), session("c")]);
	});
});

describe("storage", () => {
	it("round-trips entries through sessionStorage under ccb-navigation-history", () => {
		const storage = new MemoryStorage();
		const entries: RecentEntry[] = [
			session("a", "Alpha"),
			{key: "plan:p", kind: "plan", href: "/plan/p", title: "Plan P"},
		];
		saveRecents(entries, storage);
		expect(RECENTS_HISTORY_STORAGE_KEY).toBe("ccb-navigation-history");
		expect(JSON.parse(storage.getItem(RECENTS_HISTORY_STORAGE_KEY) ?? "null")).toEqual(entries);
		expect(loadRecents(storage)).toEqual(entries);
	});

	it("loads [] when nothing is stored", () => {
		expect(loadRecents(new MemoryStorage())).toEqual([]);
	});

	it.each([
		["corrupt JSON", "{not json"],
		["a non-array", '{"key":"session:a"}'],
		["an unknown kind", '[{"key":"x:a","kind":"chat","href":"/x/a"}]'],
		["an extra field", '[{"key":"session:a","kind":"session","href":"/session/a","extra":1}]'],
	])("loads [] for %s", (_label, raw) => {
		const storage = new MemoryStorage();
		storage.setItem(RECENTS_HISTORY_STORAGE_KEY, raw);
		expect(loadRecents(storage)).toEqual([]);
	});

	it("is a no-op when storage throws or is missing", () => {
		expect(loadRecents(new ThrowingStorage())).toEqual([]);
		expect(() => saveRecents([session("a")], new ThrowingStorage())).not.toThrow();
		expect(loadRecents(null)).toEqual([]);
		expect(() => saveRecents([session("a")], null)).not.toThrow();
	});
});

describe("resolved recent session identities", () => {
	const alias: RecentEntry = {
		key: "session:session_alice_100",
		kind: "session",
		href: "/session/session_alice_100",
		title: "Alice visit",
	};
	const local: RecentEntry = {
		key: "session:local-alice",
		kind: "session",
		href: "/session/local-alice",
		title: "Earlier visit",
	};

	it("resolves and deduplicates aliases in visit order while retaining unresolved navigation entries", () => {
		const pending: RecentEntry = {
			...alias,
			key: "session:session_bob_100",
			href: "/session/session_bob_100",
			title: "Bob visit",
		};
		expect(
			resolveRecentSessions([alias, pending, local], (id) => (id === "session_alice_100" ? "local-alice" : null)),
		).toStrictEqual([{...alias, key: "session:local-alice"}, pending]);
	});

	it("keeps an older UUID title when the newest alias visit has no title", () => {
		const {title: _title, ...untitledAlias} = alias;
		expect(resolveRecentSessions([untitledAlias, local], () => "local-alice")).toStrictEqual([
			{...untitledAlias, key: "session:local-alice", title: "Earlier visit"},
		]);
	});

	it.each([null, "local-bob"])("keeps a known UUID owner when its saved alias resolves to %s", (owner) => {
		expect(resolveRecentSessions([{...local, href: alias.href}], () => owner)).toStrictEqual([local]);
	});

	it("keeps a verified alias href for its known UUID owner", () => {
		const verified = {...local, href: alias.href};
		expect(resolveRecentSessions([verified], () => "local-alice")).toStrictEqual([verified]);
	});
});
