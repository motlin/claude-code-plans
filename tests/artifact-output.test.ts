import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {isArtifactCardCall, parseArtifactOutput} from "../src/lib/artifact-output";

interface ArtifactSample {
	input: unknown;
	is_error: boolean;
	tool_result_text: string;
	toolUseResult: unknown;
}

const fixture = JSON.parse(readFileSync(resolve(__dirname, "fixtures/artifact-tool-samples.json"), "utf8")) as {
	samples: ArtifactSample[];
};

const UUID = "29d89ae8-e33b-4f55-bbbd-874d5d316169";
const UUID_URL = `https://claude.ai/code/artifact/${UUID}`;
const SLUG = "88kDDG41ePqvfVZNsq4HCF";
const SLUG_URL = `https://claude.ai/artifact/${SLUG}`;

describe("parseArtifactOutput: JSON output", () => {
	it("reads url and path from a JSON object", () => {
		expect(parseArtifactOutput(JSON.stringify({url: UUID_URL, path: "/tmp/page.html"}))).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
			path: "/tmp/page.html",
		});
	});

	it("marks an opened artifact", () => {
		expect(parseArtifactOutput(`  ${JSON.stringify({url: SLUG_URL, opened: true})}\n`)).toEqual({
			url: SLUG_URL,
			kind: "slug",
			id: SLUG,
			opened: true,
		});
	});

	it("ignores a non-string path", () => {
		expect(parseArtifactOutput(JSON.stringify({url: UUID_URL, path: 3}))).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
		});
	});

	it("rejects a JSON url on another host", () => {
		expect(parseArtifactOutput(JSON.stringify({url: "https://example.com/artifact/abc"}))).toBe(undefined);
	});
});

describe("parseArtifactOutput: Created/Updated/Opened prefixes", () => {
	it("parses a type-created artifact with its version", () => {
		expect(
			parseArtifactOutput(
				`Created a new Artifact at ${SLUG_URL} (version 1790103359-22eb) from the Artifact type https://claude.ai/artifact/Rp9naXUCj2xozpUkyQy19W (release 1790098900-58f7).`,
			),
		).toEqual({url: SLUG_URL, kind: "slug", id: SLUG, version: "1790103359-22eb"});
	});

	it("captures the path from an update", () => {
		expect(
			parseArtifactOutput(
				`Updated the Artifact at ${UUID_URL} (version 1788311711-b0a2) with /Users/me/page.html (and any \`files\` listed).`,
			),
		).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
			path: "/Users/me/page.html",
			version: "1788311711-b0a2",
		});
	});

	it("marks an opened artifact", () => {
		expect(parseArtifactOutput(`Opened the Artifact at ${UUID_URL} in the browser.`)).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
			opened: true,
		});
	});

	it("rejects a prefixed url on another host", () => {
		expect(parseArtifactOutput("Opened the Artifact at https://evil.example/artifact/x")).toBe(undefined);
	});
});

describe("parseArtifactOutput: Published fallback (CLI format)", () => {
	it("parses a publish with trailing prose", () => {
		expect(
			parseArtifactOutput(
				`Published /Users/craig/projects/quarto/dist/quarto.html at ${UUID_URL}\n\nLive subscription: arming in the background.`,
			),
		).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
			path: "/Users/craig/projects/quarto/dist/quarto.html",
		});
	});

	it("does not fold a (Version 2) suffix into the url", () => {
		expect(parseArtifactOutput(`Published /tmp/a b.html at ${UUID_URL} (Version 2)`)).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
			path: "/tmp/a b.html",
		});
	});

	it("reads the version id from a (Version N, version id X) suffix", () => {
		expect(
			parseArtifactOutput(
				`Published /tmp/style-picker.html at https://claude.ai/artifact/MEmzwp2BgenUJAVwofipiG (Version 1, version id 1790616153-6b48) Icon: "palette".`,
			),
		).toEqual({
			url: "https://claude.ai/artifact/MEmzwp2BgenUJAVwofipiG",
			kind: "slug",
			id: "MEmzwp2BgenUJAVwofipiG",
			path: "/tmp/style-picker.html",
			version: "1790616153-6b48",
		});
	});

	it("uses the last artifact url and skips other hosts", () => {
		expect(
			parseArtifactOutput(
				`See https://claude.ai/code/artifact/00000000-0000-4000-8000-000000000000 and ${UUID_URL}. Docs at https://example.com/artifact/zzz`,
			),
		).toEqual({url: UUID_URL, kind: "uuid", id: UUID});
	});

	it("normalizes credentials, query, hash, and the www alias", () => {
		expect(
			parseArtifactOutput(`Published /tmp/x.html at https://u:p@www.claude.ai/code/artifact/${UUID}?sk=1#top`),
		).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
			path: "/tmp/x.html",
		});
	});

	it("rejects look-alike hosts", () => {
		expect(parseArtifactOutput(`Published /tmp/x.html at https://claude.ai.evil.com/code/artifact/${UUID}`)).toBe(
			undefined,
		);
		expect(parseArtifactOutput(`Published /tmp/x.html at http://claude.ai/code/artifact/${UUID}`)).toBe(undefined);
	});

	it("rejects non-artifact claude.ai paths", () => {
		expect(parseArtifactOutput("Published /tmp/x.html at https://claude.ai/code/session_123")).toBe(undefined);
	});
});

describe("parseArtifactOutput: errors and empty output", () => {
	it.each([
		"",
		"Error: claude-sonnet-5[1m] is temporarily unavailable (rate-limited), so auto mode cannot determine the safety of Artifact right now.",
		"Error: publish failed (HTTP 413): artifact exceeds 16MB",
		"{not json",
		JSON.stringify({error: "nope"}),
	])("returns undefined for %j", (text) => {
		expect(parseArtifactOutput(text)).toBe(undefined);
	});
});

describe("parseArtifactOutput: toolUseResult", () => {
	it("prefers the toolUseResult title and version", () => {
		expect(
			parseArtifactOutput(`Published /tmp/x.html at ${UUID_URL} (version 1-text)`, {
				url: UUID_URL,
				path: "/tmp/x.html",
				title: "Quarto Oracle",
				version: "1788311711-b0a2",
				updated: true,
				liveSubscription: "connected",
			}),
		).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
			path: "/tmp/x.html",
			title: "Quarto Oracle",
			version: "1788311711-b0a2",
		});
	});

	it("ignores a string (error) toolUseResult", () => {
		expect(parseArtifactOutput(`Published /tmp/x.html at ${UUID_URL}`, "Error: x")).toEqual({
			url: UUID_URL,
			kind: "uuid",
			id: UUID,
			path: "/tmp/x.html",
		});
	});

	it("parses every real publish sample and takes its title", () => {
		const parsed = fixture.samples
			.filter((sample) => isArtifactCardCall(sample.input, sample.is_error))
			.map((sample) => {
				const result = sample.toolUseResult as {url: string; title: string};
				const text = sample.tool_result_text.includes(result.url)
					? sample.tool_result_text
					: `Published x at ${result.url}`;
				const artifact = parseArtifactOutput(text, sample.toolUseResult);
				return [artifact?.url, artifact?.title] as const;
			});
		expect(parsed).toEqual(
			fixture.samples
				.filter((sample) => isArtifactCardCall(sample.input, sample.is_error))
				.map((sample) => {
					const result = sample.toolUseResult as {url: string; title: string};
					return [result.url, result.title] as const;
				}),
		);
		expect(parsed.length).toBe(17);
	});
});

describe("isArtifactCardCall", () => {
	it.each([
		[{file_path: "/tmp/x.html"}, false, true],
		[{action: "publish", type_url: SLUG_URL, title: "t"}, false, true],
		[{action: "open", url: UUID_URL}, false, true],
		[{file_path: "/tmp/x.html"}, true, false],
		[{action: "read", url: UUID_URL}, false, false],
		[{action: "list"}, false, false],
		[{action: "read_db", url: UUID_URL}, false, false],
		[{action: "pin", url: UUID_URL}, false, false],
		[{action: "quickstart", intent: "document"}, false, false],
		[undefined, false, false],
		["publish", false, false],
	])("%j (is_error %s) → %s", (input, isError, expected) => {
		expect(isArtifactCardCall(input, isError)).toBe(expected);
	});
});
