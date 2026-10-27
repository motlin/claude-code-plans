// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {
	HOME_RECENT_LIMIT,
	HomeLaunchFolderProvider,
	type HomeWorktree,
	useHomeWorktree,
} from "../src/components/home/launch-folder";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";
import {HOME_WORKTREE_STORAGE_KEY} from "../src/lib/home-worktree-pref";
import {installLocalStorage} from "./fake-storage";

function withQueries(children: ReactNode) {
	const client = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
	client.setQueryData(projectsQueryOptions().queryKey, []);
	client.setQueryData(recentSessionsQueryOptions(HOME_RECENT_LIMIT).queryKey, {sessions: [], nextCursor: null});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type Snapshot = Pick<HomeWorktree, "enabled" | "supported" | "useWorktree">;

const handles: Record<string, HomeWorktree> = {};

function Consumer({name, isGitRepo}: Readonly<{name: string; isGitRepo?: boolean}>) {
	const worktree = useHomeWorktree(isGitRepo);
	handles[name] = worktree;
	return <output aria-label={name}>{JSON.stringify(snapshotOf(worktree))}</output>;
}

function snapshotOf({enabled, supported, useWorktree}: HomeWorktree): Snapshot {
	return {enabled, supported, useWorktree};
}

function read(name: string): Snapshot {
	return JSON.parse(screen.getByRole("status", {name}).textContent) as Snapshot;
}

function renderHome(isGitRepo?: boolean) {
	return render(
		withQueries(
			<HomeLaunchFolderProvider>
				<Consumer name="composer" {...(isGitRepo === undefined ? {} : {isGitRepo})} />
				<Consumer name="card" />
			</HomeLaunchFolderProvider>,
		),
	);
}

function handle(name: string): HomeWorktree {
	const worktree = handles[name];
	if (worktree === undefined) throw new Error(`no consumer ${name}`);
	return worktree;
}

let storage: ReturnType<typeof installLocalStorage>;

beforeEach(() => {
	storage = installLocalStorage();
});

afterEach(() => {
	cleanup();
});

describe("useHomeWorktree", () => {
	it("defaults to off, supported while the folder's git status is unknown", () => {
		renderHome();
		expect(read("composer")).toStrictEqual({enabled: false, supported: true, useWorktree: false});
		expect(storage.getItem(HOME_WORKTREE_STORAGE_KEY)).toBeNull();
	});

	it("persists set(true) under upstream's key, shares it, and reads it back after a remount", () => {
		const {unmount} = renderHome();
		act(() => {
			handle("composer").set(true);
		});

		expect(storage.getItem(HOME_WORKTREE_STORAGE_KEY)).toBe("true");
		expect([read("composer"), read("card")]).toStrictEqual([
			{enabled: true, supported: true, useWorktree: true},
			{enabled: true, supported: true, useWorktree: true},
		]);

		unmount();
		renderHome();
		expect(read("card")).toStrictEqual({enabled: true, supported: true, useWorktree: true});
	});

	it("lets a per-draft override win over the preference until a hand toggle clears it", () => {
		storage.setItem(HOME_WORKTREE_STORAGE_KEY, "true");
		renderHome();

		act(() => {
			handle("composer").setForDraft(false);
		});
		expect(read("card")).toStrictEqual({enabled: false, supported: true, useWorktree: false});
		expect(storage.getItem(HOME_WORKTREE_STORAGE_KEY)).toBe("true");

		act(() => {
			handle("composer").setForDraft(null);
		});
		expect(read("card").enabled).toBe(true);

		act(() => {
			handle("composer").setForDraft(false);
		});
		act(() => {
			handle("card").set(true);
		});
		expect(read("composer")).toStrictEqual({enabled: true, supported: true, useWorktree: true});

		act(() => {
			handle("composer").setForDraft(false);
		});
		act(() => {
			handle("card").set(false);
		});
		act(() => {
			handle("card").set(true);
		});
		expect(read("composer").enabled).toBe(true);
	});

	it("still toggles in memory when localStorage throws", () => {
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get() {
				throw new Error("denied");
			},
		});
		renderHome();
		expect(read("composer").enabled).toBe(false);

		act(() => {
			handle("composer").set(true);
		});
		expect(read("card")).toStrictEqual({enabled: true, supported: true, useWorktree: true});
	});

	it("is unsupported for a non-git folder while the preference stays on", () => {
		storage.setItem(HOME_WORKTREE_STORAGE_KEY, "true");
		renderHome(false);
		expect(read("composer")).toStrictEqual({enabled: true, supported: false, useWorktree: false});
		expect(storage.getItem(HOME_WORKTREE_STORAGE_KEY)).toBe("true");
	});

	it('ignores a stored value other than "true"', () => {
		storage.setItem(HOME_WORKTREE_STORAGE_KEY, "yes");
		renderHome();
		expect(read("composer").enabled).toBe(false);
	});

	it("keeps state local to each consumer outside a provider", () => {
		render(
			withQueries(
				<>
					<Consumer name="composer" />
					<Consumer name="card" />
				</>,
			),
		);
		act(() => {
			handle("composer").setForDraft(true);
		});
		expect([read("composer").enabled, read("card").enabled]).toStrictEqual([true, false]);
	});
});
