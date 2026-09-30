import {QueryClient} from "@tanstack/react-query";
import {beforeEach, describe, expect, it} from "vite-plus/test";

import {sessionQueryKeys} from "../src/lib/api/sessions";
import {__unreadStoreTesting as __testing, hasUnseenWork} from "../src/lib/unread-store";
import {syncUnseenFromQueryCache, unseenFlagsFromSessionQuery} from "../src/lib/unseen-query-sync";

describe("unseenFlagsFromSessionQuery", () => {
	it("reads the server flag from every session list shape", () => {
		expect({
			recent: unseenFlagsFromSessionQuery(sessionQueryKeys.recent(8), {
				sessions: [{id: "session-test-100", unseen: true}],
			}),
			recentInfinite: unseenFlagsFromSessionQuery(sessionQueryKeys.recentInfinite(), {
				pages: [{sessions: [{id: "session-test-200", unseen: false}]}],
			}),
			grouped: unseenFlagsFromSessionQuery(sessionQueryKeys.grouped(), [
				{sessions: [{id: "session-test-300", unseen: true}]},
			]),
			byIds: unseenFlagsFromSessionQuery(sessionQueryKeys.byIds(["session-test-400"]), [
				{id: "session-test-400", unseen: false},
			]),
			active: unseenFlagsFromSessionQuery(sessionQueryKeys.active(), [
				{sessionId: "session-test-500", unseen: true},
			]),
			detail: unseenFlagsFromSessionQuery(sessionQueryKeys.detail("session-test-600"), {
				viewedState: {viewedAnywhere: false},
			}),
		}).toStrictEqual({
			recent: [{id: "session-test-100", unseen: true}],
			recentInfinite: [{id: "session-test-200", unseen: false}],
			grouped: [{id: "session-test-300", unseen: true}],
			byIds: [{id: "session-test-400", unseen: false}],
			active: [{id: "session-test-500", unseen: true}],
			detail: [],
		});
	});
});

describe("syncUnseenFromQueryCache", () => {
	beforeEach(() => {
		__testing.reset();
	});

	it("seeds from cached lists and fresh fetches but not from manual cache patches", async () => {
		const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
		client.setQueryData(sessionQueryKeys.byIds(["session-test-100"]), [{id: "session-test-100", unseen: true}]);

		const unsubscribe = syncUnseenFromQueryCache(client);
		const seeded = hasUnseenWork("session-test-100");
		client.setQueryData(sessionQueryKeys.byIds(["session-test-100"]), [{id: "session-test-100", unseen: false}]);
		const afterManualPatch = hasUnseenWork("session-test-100");
		await client.fetchQuery({
			queryKey: sessionQueryKeys.active(),
			queryFn: async () => [{sessionId: "session-test-200", unseen: true}],
		});
		unsubscribe();

		expect({
			seeded,
			afterManualPatch,
			fetched: hasUnseenWork("session-test-200"),
		}).toStrictEqual({seeded: true, afterManualPatch: true, fetched: true});
	});
});
