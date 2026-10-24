// @vitest-environment jsdom
// @vitest-isolate: asserts the zoned-time module is not loaded yet, which a module graph shared with another file can break.

import {describe, expect, it} from "vite-plus/test";
import {findZonedTimes, localTimeLabel} from "../src/lib/time-with-zone";
import {renderMarkdownToHtml, subscribeZonedTimes, zonedTimesVersion} from "../src/lib/client-markdown";
import {markdownCss, ruleDeclarations} from "./markdown-css";

describe("findZonedTimes", () => {
	it("finds a clock time with a zone abbreviation, an offset or a US alias, with the zone it names", () => {
		expect({
			utc: findZonedTimes("#78 auto-merged at 19:24 UTC."),
			pm: findZonedTimes("lands at 3:05 pm EDT today"),
			offset: findZonedTimes("ran 07:30 GMT+5:30"),
			alias: findZonedTimes("standup 9:00 PT"),
			zulu: findZonedTimes("at 13:18:14Z"),
		}).toStrictEqual({
			utc: [{index: 19, text: "19:24 UTC", hour: 19, minute: 24, second: 0, zone: {offsetMinutes: 0}}],
			pm: [{index: 9, text: "3:05 pm EDT", hour: 15, minute: 5, second: 0, zone: {offsetMinutes: -240}}],
			offset: [{index: 4, text: "07:30 GMT+5:30", hour: 7, minute: 30, second: 0, zone: {offsetMinutes: 330}}],
			alias: [
				{index: 8, text: "9:00 PT", hour: 9, minute: 0, second: 0, zone: {timeZone: "America/Los_Angeles"}},
			],
			zulu: [{index: 3, text: "13:18:14Z", hour: 13, minute: 18, second: 14, zone: {offsetMinutes: 0}}],
		});
	});

	it("skips a time with no zone, an impossible time, and a zone that runs into a longer word", () => {
		expect({
			noZone: findZonedTimes("finished at 13:18:14 sharp"),
			hour: findZonedTimes("25:00 UTC"),
			minute: findZonedTimes("12:61 UTC"),
			twelveHour: findZonedTimes("13:00 pm UTC"),
			longerWord: findZonedTimes("at 10:00 UTCX"),
			offsetRange: findZonedTimes("10:00 UTC+15"),
		}).toStrictEqual({noZone: [], hour: [], minute: [], twelveHour: [], longerWord: [], offsetRange: []});
	});
});

describe("localTimeLabel", () => {
	it("formats the instant in the viewer's zone with its short zone name", () => {
		const [match] = findZonedTimes("auto-merged at 19:24 UTC.");

		expect(localTimeLabel(match!, new Date("2026-10-02T12:00:00Z"), "America/New_York", "en-US")).toBe(
			"3:24 PM EDT",
		);
	});

	it("reads a US alias in its own zone on that day", () => {
		const [match] = findZonedTimes("standup 9:00 PT");

		expect(localTimeLabel(match!, new Date("2026-10-02T12:00:00Z"), "America/New_York", "en-US")).toBe(
			"12:00 PM EDT",
		);
	});
});

describe("zoned times in markdown", () => {
	it("renders a zoned time plain until its lazy module loads, then tells the articles with a time to re-render", async () => {
		const markdown = "merged at 19:24 UTC";
		const before = renderMarkdownToHtml(markdown, {zonedTimes: true});
		const versionBefore = zonedTimesVersion(markdown, true);
		await new Promise<void>((resolve) => {
			const unsubscribe = subscribeZonedTimes(() => {
				unsubscribe();
				resolve();
			});
		});

		expect({
			before,
			versionBefore,
			after: zonedTimesVersion(markdown, true),
			noTime: zonedTimesVersion("no times here", true),
			notAsked: zonedTimesVersion(markdown, false),
		}).toStrictEqual({before: "<p>merged at 19:24 UTC</p>\n", versionBefore: 0, after: 1, noTime: 0, notAsked: 0});
	});

	it("wraps a zoned time in assistant prose in upstream's dotted time-with-zone span, but not in code or links", () => {
		const container = document.createElement("div");
		container.innerHTML = renderMarkdownToHtml("merged at 19:24 UTC, `at 19:24 UTC`, [19:24 UTC](https://x.y)", {
			zonedTimes: true,
		});

		expect(
			[...container.querySelectorAll("[data-testid='time-with-zone']")].map((span) => ({
				text: span.textContent,
				className: span.className,
				tooltip: span.getAttribute("data-local-time") !== null,
			})),
		).toStrictEqual([{text: "19:24 UTC", className: "time-with-zone", tooltip: true}]);
	});

	it("leaves zoned times plain unless the render asks for them", () => {
		expect(renderMarkdownToHtml("merged at 19:24 UTC")).toBe("<p>merged at 19:24 UTC</p>\n");
	});

	it("underlines the time dotted in secondary ink, 3px below the text", () => {
		expect(ruleDeclarations(markdownCss, ".markdown :global(.time-with-zone)")).toStrictEqual({
			position: "relative",
			"text-decoration-line": "underline",
			"text-decoration-style": "dotted",
			"text-decoration-thickness": "1px",
			"text-decoration-color": "var(--color-secondary)",
			"text-underline-offset": "3px",
		});
	});
});
