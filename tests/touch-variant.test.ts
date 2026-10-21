import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

describe("custom variants", () => {
	it("declares upstream's touch: variant as the coarse-pointer media query, next to dark", () => {
		expect(styles.match(/^@custom-variant .*$/gm)).toStrictEqual([
			"@custom-variant dark (&:is(.dark *));",
			"@custom-variant touch (@media (pointer: coarse));",
		]);
	});
});
