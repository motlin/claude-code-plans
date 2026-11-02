import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8");
const upstream = readFileSync(".llm/upstream-sync/dumps/upstream-survey-root-vars.css", "utf8");

function token(source: string, name: string): string | null {
	return source.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
}

describe("radius tokens match upstream claude.ai/code", () => {
	it("--radius-xs is upstream's .125rem (2px), so rounded-xs is 2px", () => {
		expect({local: token(styles, "--radius-xs"), upstream: token(upstream, "--radius-xs")}).toStrictEqual({
			local: "0.125rem",
			upstream: ".125rem",
		});
	});

	it("--radius-sm is upstream's .25rem (4px), so rounded-sm is 4px", () => {
		expect({local: token(styles, "--radius-sm"), upstream: token(upstream, "--radius-sm")}).toStrictEqual({
			local: "0.25rem",
			upstream: ".25rem",
		});
	});

	it("--radius-md is upstream's .375rem (6px), so rounded-md is 6px", () => {
		expect({local: token(styles, "--radius-md"), upstream: token(upstream, "--radius-md")}).toStrictEqual({
			local: "0.375rem",
			upstream: ".375rem",
		});
	});

	it("--radius-lg is upstream's .5rem (8px), so rounded-lg is 8px", () => {
		expect({local: token(styles, "--radius-lg"), upstream: token(upstream, "--radius-lg")}).toStrictEqual({
			local: "0.5rem",
			upstream: ".5rem",
		});
	});
});
