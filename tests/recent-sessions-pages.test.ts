import {describe, expect, it} from "vite-plus/test";

import {dedupeRecentPages} from "../src/lib/api/sessions";

function page(ids: string[], nextCursor: string | null) {
	return {sessions: ids.map((id) => ({id})), nextCursor};
}

describe("dedupeRecentPages", () => {
	it("drops a live session the first page carried when a later page reaches it again", () => {
		const data = {
			pages: [page(["a", "b", "live"], "1:b"), page(["c", "live", "d"], null)],
			pageParams: [null, "1:b"],
		};

		expect(dedupeRecentPages(data)).toStrictEqual({
			pages: [page(["a", "b", "live"], "1:b"), page(["c", "d"], null)],
			pageParams: [null, "1:b"],
		});
	});

	it("returns the same object when no id repeats", () => {
		const data = {pages: [page(["a"], "1:a"), page(["b"], null)], pageParams: [null, "1:a"]};

		expect(dedupeRecentPages(data)).toBe(data);
	});
});
