import {nearestCommand, osaDistance} from "../src/lib/command-suggest";

describe("osaDistance", () => {
	it("counts insertions, deletions, substitutions and adjacent transpositions", () => {
		expect([
			osaDistance("statuss", "status"),
			osaDistance("cmopact", "compact"),
			osaDistance("ab", "ba"),
			osaDistance("abc", ""),
			osaDistance("", "abc"),
			osaDistance("kitten", "sitting"),
			osaDistance("ca", "abc"),
			osaDistance("same", "same"),
		]).toStrictEqual([1, 1, 1, 3, 3, 3, 3, 0]);
	});
});

describe("nearestCommand", () => {
	it("returns the closest candidate within the threshold", () => {
		expect(nearestCommand("statuss", ["status", "stats"])).toBe("status");
	});

	it("uses threshold 1 for queries of four characters or fewer", () => {
		expect([
			nearestCommand("hlp", ["help"]),
			nearestCommand("hep", ["help"]),
			nearestCommand("xyzw", ["help"]),
			nearestCommand("hepl", ["help"]),
			nearestCommand("hx", ["help"]),
		]).toStrictEqual(["help", "help", null, "help", null]);
	});

	it("uses threshold 2 for longer queries", () => {
		expect([nearestCommand("stauts", ["status"]), nearestCommand("stxyzs", ["status"])]).toStrictEqual([
			"status",
			null,
		]);
	});

	it("matches case-insensitively and returns the candidate casing", () => {
		expect([nearestCommand("Statuss", ["status"]), nearestCommand("statuss", ["Status"])]).toStrictEqual([
			"status",
			"Status",
		]);
	});

	it("excludes exact matches", () => {
		expect(nearestCommand("status", ["status"])).toBeNull();
	});

	it("returns null on a tie at the minimum distance", () => {
		expect(nearestCommand("cat", ["bat", "hat"])).toBeNull();
	});

	it("prefers a strictly closer candidate over a tie at a larger distance", () => {
		expect(nearestCommand("compactt", ["compxxtt", "compayyt", "compact"])).toBe("compact");
	});

	it("does not count duplicate candidates as a tie", () => {
		expect(nearestCommand("compac", ["compact", "compact", "Compact"])).toBe("compact");
	});

	it("skips candidates whose length differs by more than the threshold", () => {
		expect(nearestCommand("stat", ["status"])).toBeNull();
	});

	it("returns null with no candidates", () => {
		expect(nearestCommand("status", [])).toBeNull();
	});
});
