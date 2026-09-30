import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {ArtifactToolResultSchema} from "../src/lib/artifact-schemas";
import {ArtifactInputSchema, toolInputSchemas} from "../src/lib/tool-input-schemas";

interface ArtifactSample {
	input: unknown;
	is_error: boolean;
	toolUseResult: unknown;
}

const fixture = JSON.parse(readFileSync(resolve(__dirname, "fixtures/artifact-tool-samples.json"), "utf8")) as {
	samples: ArtifactSample[];
};

describe("ArtifactInputSchema", () => {
	it("is registered for the Artifact tool", () => {
		expect(toolInputSchemas.Artifact).toBe(ArtifactInputSchema);
	});

	it.each(fixture.samples.map((sample, index) => [index, sample] as const))(
		"parses real input sample %i",
		(_index, sample) => {
			expect(ArtifactInputSchema.safeParse(sample.input).error?.issues).toBeUndefined();
		},
	);

	it("rejects an unknown key", () => {
		const result = ArtifactInputSchema.safeParse({action: "read", url: "x", bogus: 1});
		expect(result.error?.issues.map((issue) => issue.code)).toEqual(["unrecognized_keys"]);
	});

	it("rejects an unknown action", () => {
		expect(ArtifactInputSchema.safeParse({action: "explode"}).success).toBe(false);
	});

	it("accepts every documented action", () => {
		const actions = ["publish", "read", "list", "delete", "open", "pin", "unpin", "quickstart", "read_db"];
		expect(actions.filter((action) => !ArtifactInputSchema.safeParse({action}).success)).toEqual([]);
	});
});

describe("ArtifactToolResultSchema", () => {
	const successes = fixture.samples.filter((sample) => !sample.is_error);

	it.each(successes.map((sample, index) => [index, sample] as const))(
		"parses real result sample %i",
		(_index, sample) => {
			expect(ArtifactToolResultSchema.safeParse(sample.toolUseResult).error?.issues).toBeUndefined();
		},
	);

	it("accepts the plain error string of a failed call", () => {
		const failure = fixture.samples.find((sample) => sample.is_error);
		expect(ArtifactToolResultSchema.safeParse(failure?.toolUseResult).success).toBe(true);
	});

	it.each(successes.map((sample, index) => [index, sample] as const))(
		"rejects unknown key bogus on result sample %i",
		(_index, sample) => {
			const withBogus = {...(sample.toolUseResult as Record<string, unknown>), bogus: 1};
			expect(ArtifactToolResultSchema.safeParse(withBogus).success).toBe(false);
		},
	);

	it("parses a publish result into its typed shape", () => {
		expect(
			ArtifactToolResultSchema.parse({
				url: "https://claude.ai/code/artifact/29d89ae8-e33b-4f55-bbbd-874d5d316169",
				path: "/Users/craig/projects/quarto/dist/quarto.html",
				artifact_id: "29d89ae8-e33b-4f55-bbbd-874d5d316169",
				title: "Quarto Oracle",
				updated: true,
				audience: "owner",
				version: "1788311711-b0a2",
				contract: "0.0.0",
				liveSubscription: "connected",
			}),
		).toEqual({
			url: "https://claude.ai/code/artifact/29d89ae8-e33b-4f55-bbbd-874d5d316169",
			path: "/Users/craig/projects/quarto/dist/quarto.html",
			artifact_id: "29d89ae8-e33b-4f55-bbbd-874d5d316169",
			title: "Quarto Oracle",
			updated: true,
			audience: "owner",
			version: "1788311711-b0a2",
			contract: "0.0.0",
			liveSubscription: "connected",
		});
	});

	it("rejects an unknown liveSubscription state", () => {
		expect(
			ArtifactToolResultSchema.safeParse({
				url: "https://claude.ai/code/artifact/x",
				path: "/a.html",
				title: "A",
				updated: false,
				version: "1",
				liveSubscription: "sideways",
			}).success,
		).toBe(false);
	});
});
