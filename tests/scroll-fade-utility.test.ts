import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";

async function compile(candidate: string): Promise<string | null> {
	const [rule] = (await loadDesignSystem()).candidatesToCss([candidate]);
	return rule ?? null;
}

describe("scroll-fade-y", () => {
	it("ports cds' scroll-driven edge fade: scroll padding always, the mask only where scroll timelines exist", async () => {
		const rule = (await compile("scroll-fade-y"))?.replaceAll(/\s+/g, " ") ?? "";
		const styles = readFileSync("src/styles/globals.css", "utf8");

		expect({
			scrollPadding: rule.includes(
				"scroll-padding-top: calc(var(--scroll-fade-size) * var(--scroll-fade-top-on)); scroll-padding-bottom: calc(var(--scroll-fade-size) * var(--scroll-fade-bottom-on));",
			),
			supports: rule.includes("@supports (animation-timeline: scroll())"),
			mask: rule.includes("mask-image: linear-gradient( to bottom, transparent,"),
			timeline: rule.includes("animation-timeline: scroll(self block);"),
			ranges: rule.includes(
				"animation-range: 0px var(--scroll-fade-size), calc(100% - var(--scroll-fade-size)) 100%, 0px 101%;",
			),
			keyframes: ["scroll-fade-top", "scroll-fade-bottom", "scroll-fade-y-active"].map((name) =>
				styles.includes(`@keyframes ${name} {`),
			),
			size: styles.includes(
				'@property --scroll-fade-size {\n\tsyntax: "<length>";\n\tinherits: true;\n\tinitial-value: 28px;\n}',
			),
		}).toStrictEqual({
			scrollPadding: true,
			supports: true,
			mask: true,
			timeline: true,
			ranges: true,
			keyframes: [true, true, true],
			size: true,
		});
	});
});
