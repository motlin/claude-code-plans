// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ArtifactSourcePreview} from "../src/components/artifact-source-preview";
import type {ArtifactSummary} from "../src/lib/api/artifacts";
import {artifactPreviewPath, artifactSourceUrl} from "../src/lib/artifact-source-paths";

afterEach(cleanup);

const ARTIFACT: ArtifactSummary = {
	url: "https://claude.ai/code/artifact/546d3910-4e9a-4730-9e91-62742a47c7c6",
	id: "546d3910-4e9a-4730-9e91-62742a47c7c6",
	kind: "html",
	title: "Asap Ladder Queue",
	description: null,
	sourcePath: "/Users/alice/projects/ladder/.llm/mockups/ladder.html",
	sourceExists: true,
	sourceModifiedAt: 2_000,
	audience: "owner",
	firstSeenAt: 1_000,
	lastPublishedAt: 2_000,
	publishCount: 1,
	sessionId: "session-ladder",
	projectId: "-Users-alice-projects-ladder",
};

function previewSummary() {
	const iframe = document.querySelector("iframe");
	return {
		sandbox: iframe?.getAttribute("sandbox"),
		src: iframe?.getAttribute("src"),
		title: iframe?.getAttribute("title"),
		banner: screen.getByRole("note").textContent,
	};
}

describe("artifact source paths", () => {
	it("addresses the source API and preview page by encoded id", () => {
		expect({
			source: artifactSourceUrl("a b/c"),
			preview: artifactPreviewPath("a b/c"),
		}).toStrictEqual({
			source: "/api/artifacts/a%20b%2Fc/source",
			preview: "/artifact/a%20b%2Fc",
		});
	});
});

describe("ArtifactSourcePreview", () => {
	it("renders the source in a scripts-only sandboxed iframe under the local-source banner", () => {
		render(<ArtifactSourcePreview artifact={ARTIFACT} />);

		expect(previewSummary()).toStrictEqual({
			sandbox: "allow-scripts",
			src: "/api/artifacts/546d3910-4e9a-4730-9e91-62742a47c7c6/source",
			title: "Local source of Asap Ladder Queue",
			banner: "Local source · may differ from the published versionMulti-file artifacts are not supported, so relative assets may not load.",
		});
	});

	it("flags a source modified after its last publish", () => {
		render(<ArtifactSourcePreview artifact={{...ARTIFACT, sourceModifiedAt: 2_001}} />);

		expect(previewSummary().banner).toBe(
			"Local source · may differ from the published version · modified since publishMulti-file artifacts are not supported, so relative assets may not load.",
		);
	});

	it("links out to claude.ai instead of framing a missing source", () => {
		render(<ArtifactSourcePreview artifact={{...ARTIFACT, sourceExists: false, sourceModifiedAt: null}} />);

		const link = screen.getByRole("link", {name: "Open on claude.ai"});
		expect({
			iframes: document.querySelectorAll("iframe").length,
			text: screen.getByText(/local source/i).textContent,
			href: link.getAttribute("href"),
			target: link.getAttribute("target"),
			rel: link.getAttribute("rel"),
		}).toStrictEqual({
			iframes: 0,
			text: "The local source file for this artifact no longer exists.",
			href: ARTIFACT.url,
			target: "_blank",
			rel: "noopener noreferrer",
		});
	});
});
