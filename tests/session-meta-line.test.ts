import {sessionMetaLine} from "../src/lib/session-meta-line";
import type {GitPrState} from "../src/lib/pr-status";

const pr: GitPrState = "opened";

describe("sessionMetaLine", () => {
	it("shows branch and folder when the heading is not the folder", () => {
		expect(
			sessionMetaLine({
				bucket: "done",
				underNeedsInput: false,
				branch: "main",
				folder: "claude-code-plans",
				heading: "Completed",
			}),
		).toEqual({kind: "place", branch: "main", folder: "claude-code-plans"});
	});

	it("drops the folder when the group heading equals it", () => {
		expect(
			sessionMetaLine({
				bucket: "done",
				underNeedsInput: false,
				branch: "main",
				folder: "claude-code-plans",
				heading: "claude-code-plans",
			}),
		).toEqual({kind: "place", branch: "main"});
	});

	it("drops the folder when the group heading starts with `{folder} · `", () => {
		expect(
			sessionMetaLine({
				bucket: "working",
				underNeedsInput: false,
				branch: "main",
				folder: "claude-code-plans",
				heading: "claude-code-plans · main",
			}),
		).toEqual({kind: "place", branch: "main"});
	});

	it("has no line with no branch under the matching heading", () => {
		expect(
			sessionMetaLine({
				bucket: "done",
				underNeedsInput: false,
				folder: "claude-code-plans",
				heading: "claude-code-plans",
			}),
		).toBeUndefined();
	});

	it("keeps the folder under the matching heading when there is a PR but no branch", () => {
		expect(
			sessionMetaLine({
				bucket: "review",
				underNeedsInput: false,
				pr,
				folder: "claude-code-plans",
				heading: "claude-code-plans",
			}),
		).toEqual({kind: "place", pr, folder: "claude-code-plans"});
	});

	it("has no line with no branch and no folder", () => {
		expect(sessionMetaLine({bucket: "done", underNeedsInput: false, pr, heading: "Completed"})).toBeUndefined();
	});

	it("shows only the reason for a blocked row under Needs input", () => {
		expect(
			sessionMetaLine({
				bucket: "blocked",
				underNeedsInput: true,
				reason: "Asked a question",
				branch: "main",
				folder: "claude-code-plans",
				heading: "Needs input",
			}),
		).toEqual({kind: "blocked", word: false, reason: "Asked a question"});
	});

	it("shows the Blocked word for a blocked row under a project heading with no reason", () => {
		expect(
			sessionMetaLine({
				bucket: "blocked",
				underNeedsInput: false,
				branch: "main",
				folder: "claude-code-plans",
				heading: "claude-code-plans",
			}),
		).toEqual({kind: "blocked", word: true});
	});

	it("has no line for a blocked row under Needs input with no reason", () => {
		expect(
			sessionMetaLine({
				bucket: "blocked",
				underNeedsInput: true,
				branch: "main",
				folder: "claude-code-plans",
				heading: "Needs input",
			}),
		).toBeUndefined();
	});
});
