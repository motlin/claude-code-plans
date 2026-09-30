import {describe, expect, it} from "vite-plus/test";

import {resolveFamilies, type FamilyRow, type SessionFamily} from "../src/lib/session-families";

function row(sessionId: string, overrides: Partial<FamilyRow> = {}): FamilyRow {
	return {sessionId, bucket: "done", archived: false, ...overrides};
}

function summarize(families: SessionFamily<FamilyRow>[]) {
	return families.map((family) => ({
		head: family.head.sessionId,
		children: family.children.map((child) => child.sessionId),
		bucket: family.bucket,
	}));
}

describe("resolveFamilies", () => {
	it.each([
		{
			name: "unrelated rows are single-member families in input order",
			rows: [row("A"), row("B")],
			expected: [
				{head: "A", children: [], bucket: "done"},
				{head: "B", children: [], bucket: "done"},
			],
		},
		{
			name: "chain A<-B<-C nests under the top ancestor",
			rows: [row("C", {forkedFromSessionId: "B"}), row("A"), row("B", {forkedFromSessionId: "A"})],
			expected: [{head: "A", children: ["B", "C"], bucket: "done"}],
		},
		{
			name: "siblings keep input order and a grandchild follows its own parent",
			rows: [
				row("A"),
				row("B", {forkedFromSessionId: "A"}),
				row("C", {forkedFromSessionId: "A"}),
				row("D", {forkedFromSessionId: "B"}),
			],
			expected: [{head: "A", children: ["B", "D", "C"], bucket: "done"}],
		},
		{
			name: "a cycle is cut at its first row in input order",
			rows: [
				row("A", {forkedFromSessionId: "C"}),
				row("B", {forkedFromSessionId: "A"}),
				row("C", {forkedFromSessionId: "B"}),
			],
			expected: [{head: "A", children: ["B", "C"], bucket: "done"}],
		},
		{
			name: "a self-fork is its own head",
			rows: [row("A", {forkedFromSessionId: "A"})],
			expected: [{head: "A", children: [], bucket: "done"}],
		},
		{
			name: "a missing (filtered-out) parent leaves the row top-level",
			rows: [row("B", {forkedFromSessionId: "gone"}), row("C", {forkedFromSessionId: "B"})],
			expected: [{head: "B", children: ["C"], bucket: "done"}],
		},
		{
			name: "an active child is not nested under an archived parent",
			rows: [
				row("A"),
				row("B", {forkedFromSessionId: "A", archived: true}),
				row("C", {forkedFromSessionId: "B"}),
				row("D", {forkedFromSessionId: "B", archived: true}),
			],
			expected: [
				{head: "A", children: ["B", "D"], bucket: "done"},
				{head: "C", children: [], bucket: "done"},
			],
		},
	])("$name", ({rows, expected}) => {
		expect(summarize(resolveFamilies(rows))).toStrictEqual(expected);
	});

	it.each([
		{buckets: ["done", "review"], expected: "review"},
		{buckets: ["review", "working"], expected: "working"},
		{buckets: ["working", "blocked", "done"], expected: "blocked"},
		{buckets: ["done", "done"], expected: "done"},
	] as const)("family bucket is the most urgent of $buckets", ({buckets, expected}) => {
		const rows = buckets.map((bucket, index) =>
			row(`S${index}`, index === 0 ? {bucket} : {bucket, forkedFromSessionId: "S0"}),
		);
		expect(summarize(resolveFamilies(rows))).toStrictEqual([
			{
				head: "S0",
				children: buckets.slice(1).map((_, index) => `S${index + 1}`),
				bucket: expected,
			},
		]);
	});

	it("returns the original row objects", () => {
		const head = row("A");
		const child = row("B", {forkedFromSessionId: "A"});
		expect(resolveFamilies([head, child])).toStrictEqual([{head, children: [child], bucket: "done"}]);
		expect(resolveFamilies([head, child])[0]?.children[0]).toBe(child);
	});
});
