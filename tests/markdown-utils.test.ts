import {humanizeFilename, extractTitleFromContent} from "../src/lib/markdown-utils.js";

describe("humanizeFilename", () => {
	it("converts dashes and underscores to title case", () => {
		expect(humanizeFilename("my-cool-plan.md")).toBe("My Cool Plan");
	});

	it("strips .md extension", () => {
		expect(humanizeFilename("readme.md")).toBe("Readme");
	});
});

describe("extractTitleFromContent", () => {
	it("extracts title from # heading", () => {
		expect(extractTitleFromContent("# My Title\n\nContent", "file.md")).toBe("My Title");
	});

	it("falls back to humanized filename", () => {
		expect(extractTitleFromContent("No heading here", "my-file.md")).toBe("My File");
	});

	it("falls back for empty content", () => {
		expect(extractTitleFromContent("", "fallback.md")).toBe("Fallback");
	});
});
