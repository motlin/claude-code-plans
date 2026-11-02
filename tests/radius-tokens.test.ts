import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");
const upstream = readFileSync(".llm/upstream-sync/dumps/upstream-survey-root-vars.css", "utf8");

function token(source: string, name: string): string | null {
	return source.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
}

describe("radius tokens match upstream claude.ai/code", () => {
	it("--radius-sm is upstream's .25rem (4px), so rounded-sm is 4px", () => {
		expect({local: token(styles, "--radius-sm"), upstream: token(upstream, "--radius-sm")}).toStrictEqual({
			local: "0.25rem",
			upstream: ".25rem",
		});
	});

	it("--radius-lg is upstream's .5rem (8px), so rounded-lg is 8px", () => {
		expect({local: token(styles, "--radius-lg"), upstream: token(upstream, "--radius-lg")}).toStrictEqual({
			local: "0.5rem",
			upstream: ".5rem",
		});
	});
});
