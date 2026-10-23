// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {WorkingMark} from "../src/components/working-mark";
import {toolMarkActivity, WORKING_MARK_FRAMES, workingLineActivity} from "../src/lib/working-mark-activity";

afterEach(() => {
	cleanup();
});

describe("toolMarkActivity", () => {
	it("ports upstream's activity resolver", () => {
		const cases: [string, Record<string, unknown>][] = [
			["Bash", {command: "ls"}],
			["Bash", {command: "cat x", description: "Read the config"}],
			["Bash", {command: "cat x", description: "Reading the config"}],
			["Bash", {command: "echo x > y", description: "Write the file"}],
			["Bash", {command: "rm x", description: "Removes the temp dir"}],
			["Bash", {command: "pnpm test", description: "Run the tests"}],
			["PowerShell", {command: "dir", description: "List files"}],
			["Read", {}],
			["Glob", {}],
			["Grep", {}],
			["Write", {}],
			["Edit", {}],
			["MultiEdit", {}],
			["NotebookEdit", {}],
			["TodoWrite", {}],
			["WebFetch", {}],
			["WebSearch", {}],
			["mcp__github__create_pull_request", {}],
			["mcp__github__list_issues", {}],
			["mcp__ide__execute_code", {}],
			["mcp__memory__memory_view", {}],
			["mcp__memory__memory_store", {}],
			["mcp__x__image_search", {}],
			["Agent", {}],
			["Skill", {}],
		];
		expect(cases.map(([name, input]) => [name, toolMarkActivity(name, input)])).toStrictEqual([
			["Bash", "code"],
			["Bash", "read"],
			["Bash", "read"],
			["Bash", "write"],
			["Bash", "write"],
			["Bash", "code"],
			["PowerShell", "read"],
			["Read", "read"],
			["Glob", "read"],
			["Grep", "read"],
			["Write", "write"],
			["Edit", "write"],
			["MultiEdit", "write"],
			["NotebookEdit", "write"],
			["TodoWrite", "write"],
			["WebFetch", "search"],
			["WebSearch", "search"],
			["mcp__github__create_pull_request", "write"],
			["mcp__github__list_issues", "read"],
			["mcp__ide__execute_code", "code"],
			["mcp__memory__memory_view", "read"],
			["mcp__memory__memory_store", "write"],
			["mcp__x__image_search", "search"],
			["Agent", "default"],
			["Skill", "default"],
		]);
	});

	it("plays think on the working line while thinking, else default", () => {
		expect([workingLineActivity(true), workingLineActivity(false)]).toStrictEqual(["think", "default"]);
	});

	it("uses upstream's loop sheet frame counts", () => {
		expect(WORKING_MARK_FRAMES).toStrictEqual({
			default: 40,
			think: 110,
			search: 20,
			read: 60,
			code: 75,
			write: 60,
			compose: 62,
			blocked: 30,
		});
	});
});

describe("WorkingMark", () => {
	it("plays the activity's 20px loop strip in 33.33ms steps", () => {
		const {container} = render(<WorkingMark activity="read" />);
		const mark = container.querySelector('[data-cds="WorkingMark"]');
		const strip = mark?.querySelector("[data-working-mark-strip]") as HTMLElement | null;
		expect({
			activity: mark?.getAttribute("data-activity"),
			animated: mark?.getAttribute("data-animated"),
			hidden: mark?.getAttribute("aria-hidden"),
			className: mark?.className,
			style: mark?.getAttribute("style"),
			layerClass: strip?.parentElement?.className,
			width: strip?.style.width,
			height: strip?.style.height,
			image: strip?.style.backgroundImage,
			size: strip?.style.backgroundSize,
			end: strip?.style.getPropertyValue("--working-mark-end"),
			animation: strip?.style.animation,
		}).toStrictEqual({
			activity: "read",
			animated: "true",
			hidden: "true",
			className: "relative block shrink-0 select-none",
			style: "width: 20px; height: 20px; color: var(--color-clay);",
			layerClass: "absolute inset-0 overflow-clip",
			width: "20px",
			height: "1200px",
			image: 'url("/working-mark/read.webp")',
			size: "100% 100%",
			end: "-1180px",
			animation: "working-mark-strip 2000ms steps(60, jump-none) infinite",
		});
	});

	it("holds frame 0 when not animated", () => {
		const {container} = render(<WorkingMark activity="think" animated={false} className="me-1.5" />);
		const mark = container.querySelector('[data-cds="WorkingMark"]');
		const strip = mark?.querySelector("[data-working-mark-strip]") as HTMLElement | null;
		expect({
			animated: mark?.getAttribute("data-animated"),
			className: mark?.className,
			animation: strip?.style.animation,
		}).toStrictEqual({animated: "false", className: "relative block shrink-0 select-none me-1.5", animation: ""});
	});
});
