import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");

describe("custom variants", () => {
	it("declares upstream's touch: variant as the coarse-pointer or no-hover media query, next to dark and the density variants", () => {
		expect(styles.match(/^@custom-variant .*$/gm)).toStrictEqual([
			"@custom-variant dark (&:is(.dark *));",
			"@custom-variant touch (@media (pointer: coarse), (hover: none));",
			'@custom-variant compact (&:where([data-density="compact"] *):not(:where([data-density="compact"] [data-density="comfortable"] *)));',
			'@custom-variant comfortable (&:where([data-density="comfortable"] *):not(:where([data-density="comfortable"] [data-density="compact"] *)));',
		]);
	});
});
