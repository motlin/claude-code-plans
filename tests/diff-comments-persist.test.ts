import {beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {installLocalStorage} from "./fake-storage";

const SESSION = "session-alice";
const OTHER = "session-bob";

async function freshStore(): Promise<typeof import("../src/lib/diff-comments")> {
	vi.resetModules();
	return import("../src/lib/diff-comments");
}

describe("diff comment persistence", () => {
	beforeEach(() => {
		installLocalStorage();
	});

	it("restores saved comments after a reload and drops drafts and edit text", async () => {
		const store = await freshStore();
		const saved = store.openDiffCommentDraft(SESSION, {path: "src/greet.ts", side: "additions", line: 3});
		store.saveDiffComment(SESSION, saved, "  Use a template literal  ");
		store.activateDiffComment(SESSION, saved);
		store.setDiffCommentEditBody(SESSION, saved, "unsaved edit");
		const draft = store.openDiffCommentDraft(SESSION, {
			path: "src/greet.ts",
			side: "deletions",
			line: 2,
			endLine: 4,
		});
		store.setDiffCommentDraftBody(SESSION, draft, "half typed");

		expect(JSON.parse(localStorage.getItem("diff-annotations") ?? "null")).toStrictEqual({
			version: 0,
			state: {
				commentsBySession: {
					[SESSION]: [
						{id: saved, path: "src/greet.ts", side: "additions", line: 3, text: "Use a template literal"},
					],
				},
			},
		});

		const reloaded = await freshStore();
		expect(reloaded.getDiffComments(SESSION)).toStrictEqual({
			drafts: [],
			queued: [{id: saved, path: "src/greet.ts", side: "additions", line: 3, text: "Use a template literal"}],
		});
		expect(reloaded.getDiffCommentEditing(SESSION)).toStrictEqual({bodies: {}, editBodies: {}, activeId: null});
	});

	it("gives new comments after a reload ids that do not collide with restored ones", async () => {
		const store = await freshStore();
		const first = store.openDiffCommentDraft(SESSION, {path: "a.ts", side: "additions", line: 1});
		store.saveDiffComment(SESSION, first, "first");

		const reloaded = await freshStore();
		const second = reloaded.openDiffCommentDraft(SESSION, {path: "a.ts", side: "additions", line: 1});
		expect(second).not.toBe(first);
		reloaded.saveDiffComment(SESSION, second, "second");
		expect(reloaded.getDiffComments(SESSION).queued.map((comment) => comment.text)).toStrictEqual([
			"first",
			"second",
		]);
	});

	it("removes a session's entry when its comments are cleared or sent", async () => {
		const store = await freshStore();
		const alice = store.openDiffCommentDraft(SESSION, {path: "a.ts", side: "additions", line: 1});
		store.saveDiffComment(SESSION, alice, "for alice");
		const bob = store.openDiffCommentDraft(OTHER, {path: "b.ts", side: "additions", line: 2});
		store.saveDiffComment(OTHER, bob, "for bob");

		store.clearDiffComments(SESSION);
		expect(JSON.parse(localStorage.getItem("diff-annotations") ?? "null")).toStrictEqual({
			version: 0,
			state: {
				commentsBySession: {[OTHER]: [{id: bob, path: "b.ts", side: "additions", line: 2, text: "for bob"}]},
			},
		});

		store.takeQueuedDiffComments(OTHER);
		expect(JSON.parse(localStorage.getItem("diff-annotations") ?? "null")).toStrictEqual({
			version: 0,
			state: {commentsBySession: {}},
		});
	});

	it("hydrates a corrupt value to empty without throwing", async () => {
		localStorage.setItem("diff-annotations", "{not json");
		const store = await freshStore();
		expect(store.getDiffComments(SESSION)).toStrictEqual({drafts: [], queued: []});

		localStorage.setItem(
			"diff-annotations",
			JSON.stringify({version: 0, state: {commentsBySession: {[SESSION]: 7}}}),
		);
		const again = await freshStore();
		expect(again.getDiffComments(SESSION)).toStrictEqual({drafts: [], queued: []});
	});
});
