import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";

const css = readFileSync(join(import.meta.dirname, "../src/styles/globals.css"), "utf8");

describe("danger text token", () =>
{
	// dumps/tool-failed-verb-labels-1105-live-failed-step.html: a failed step's outcome is `text-danger`.
	it("maps text-danger to upstream's --cds-text-danger, light then dark", () =>
	{
		expect(
			{
				color: /--color-danger:\s*([^;]+);/.exec(css)?.[1],
				values: [...css.matchAll(/--upstream-text-danger:\s*([^;]+);/g)].map((match) => match[1]),
			},
		).toStrictEqual(
			{
				color: "var(--upstream-text-danger)",
				values: ["#a42528", "#f17778"],
			},
		);
	});
});
