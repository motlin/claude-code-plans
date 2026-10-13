import {QueryClient, type QueryCacheNotifyEvent} from "@tanstack/react-query";
import {eventQueryKey} from "../src/lib/query-cache-event";

describe("eventQueryKey", () => {
	it("returns the key of the query an event is about", () => {
		const queryClient = new QueryClient();
		const events: QueryCacheNotifyEvent[] = [];
		queryClient.getQueryCache().subscribe((event) => events.push(event));
		queryClient.setQueryData(["sessions", "alice"], 1);
		expect(events.map(eventQueryKey)).toStrictEqual([
			["sessions", "alice"],
			["sessions", "alice"],
		]);
	});
});
