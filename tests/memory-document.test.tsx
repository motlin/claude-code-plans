// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {MemoryDocument} from "../src/components/memory-document";
import {parseMemoryFrontmatter} from "../src/lib/memory-frontmatter";

const FIXTURE = `---
name: backblaze-walk-cpu-xattr
description: Why bztransmit pegs CPU on the Mac
metadata:
  node_type: memory
  type: reference
---

Backblaze ran at **100%** CPU.
`;

afterEach(() => {
	cleanup();
});

describe("parseMemoryFrontmatter", () => {
	it("splits top-level name and description from the body", () => {
		expect(parseMemoryFrontmatter(FIXTURE)).toStrictEqual({
			name: "backblaze-walk-cpu-xattr",
			description: "Why bztransmit pegs CPU on the Mac",
			body: "Backblaze ran at **100%** CPU.\n",
		});
	});

	it("returns the whole document as the body when there is no frontmatter", () => {
		expect(parseMemoryFrontmatter("# Title\n\nText\n")).toStrictEqual({
			name: undefined,
			description: undefined,
			body: "# Title\n\nText\n",
		});
	});
});

describe("MemoryDocument", () => {
	it("renders the name as the h1, the description as a muted line, and drops the frontmatter", () => {
		const {container} = render(<MemoryDocument markdown={FIXTURE} />);

		expect(screen.getByRole("heading", {level: 1}).textContent).toBe("backblaze-walk-cpu-xattr");
		expect(screen.getByText("Why bztransmit pegs CPU on the Mac").className).toContain("text-t6");
		expect(container.textContent).not.toContain("metadata:");
		expect(container.textContent).not.toContain("node_type");
		expect(container.textContent).toContain("Backblaze ran at 100% CPU.");
	});

	it("renders no h1 when the memory has no frontmatter name", () => {
		render(<MemoryDocument markdown={"Plain body\n"} />);

		expect(screen.queryByRole("heading", {level: 1})).toBeNull();
	});
});
