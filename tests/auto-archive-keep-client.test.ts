// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";
import {keepClientIds, openSessionIdsFromMatches} from "../src/lib/auto-archive-keep-client";

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
}

describe("openSessionIdsFromMatches", () => {
	it("collects the sessions a tab shows on session and terminal routes, once each", () => {
		expect(
			openSessionIdsFromMatches([
				{routeId: "__root__", params: {}},
				{routeId: "/session/$id", params: {id: "session-a"}},
				{routeId: "/session/$id_/subagents", params: {id: "session-a"}},
				{routeId: "/terminals/$sessionId", params: {sessionId: "session-b"}},
				{routeId: "/project/$id_/sessions", params: {id: "project-c"}},
			]),
		).toStrictEqual(["session-a", "session-b"]);
	});
});

describe("keepClientIds", () => {
	it("keeps a browser id in localStorage and a tab id in sessionStorage across reloads", () => {
		const local = memoryStorage();
		const session = memoryStorage();
		const first = keepClientIds(local, session);
		const reload = keepClientIds(local, session);
		const otherTab = keepClientIds(local, memoryStorage());

		expect({
			reloadSame: reload,
			sameBrowser: otherTab.browserId === first.browserId,
			newTab: otherTab.tabId !== first.tabId,
		}).toStrictEqual({reloadSame: first, sameBrowser: true, newTab: true});
	});

	it("still reports with fresh ids when storage throws", () => {
		const broken = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		};

		const ids = keepClientIds(broken, broken);

		expect({browser: ids.browserId.length > 0, tab: ids.tabId.length > 0}).toStrictEqual({
			browser: true,
			tab: true,
		});
	});
});
