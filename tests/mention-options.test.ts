import {describe, expect, it} from "vite-plus/test";

import
{
	fileMentionOption,
	type MentionOption,
	mentionMenuWidth,
	mergeProviderOptions,
} from "../src/lib/mention-options";

function option(providerId: MentionOption["providerId"], id: string): MentionOption
{
	return {
		id,
		providerId,
		label: id,
		renderedText: id,
		category: "x",
		kind: providerId === "ccp-agents" ? "agent" : providerId === "ccp-sessions" ? "session" : "file",
	};
}

describe("mergeProviderOptions", () =>
{
	it("concatenates the provider lists in upstream's order: agents, sessions, files", () =>
	{
		const a1 = option("ccp-agents", "a1");
		const s1 = option("ccp-sessions", "s1");
		const s2 = option("ccp-sessions", "s2");
		const f1 = option("ccp-files", "f1");
		expect(mergeProviderOptions([[a1], [s1, s2], [f1]])).toStrictEqual([a1, s1, s2, f1]);
	});
});

describe("mentionMenuWidth", () =>
{
	it("is 560 when any row has a description and 420 otherwise, an empty menu included", () =>
	{
		expect([
			mentionMenuWidth([]),
			mentionMenuWidth([option("ccp-sessions", "s")]),
			mentionMenuWidth([
				option("ccp-files", "f"),
				{
					...option("ccp-sessions", "s"),
					description: "repo · main",
				},
			]),
		]).toStrictEqual([420, 420, 560]);
	});
});

describe("fileMentionOption", () =>
{
	it("labels a file row by basename with its dirname as the caption", () =>
	{
		expect([
			fileMentionOption(
				{
					name: "a.ts",
					relPath: "src/lib/a.ts",
					isDirectory: false,
				},
			),
			fileMentionOption(
				{
					name: "docs",
					relPath: "docs",
					isDirectory: true,
				},
			),
		]).toStrictEqual([
			{
				id: "src/lib/a.ts",
				providerId: "ccp-files",
				label: "a.ts",
				description: "src/lib",
				tooltip: "src/​lib/​a.ts",
				renderedText: "src/lib/a.ts",
				category: "Files",
				kind: "file",
				relPath: "src/lib/a.ts",
			},
			{
				id: "docs",
				providerId: "ccp-files",
				label: "docs",
				tooltip: "docs/​",
				renderedText: "docs/",
				category: "Files",
				kind: "directory",
				relPath: "docs",
			},
		]);
	});
});
