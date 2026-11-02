// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ArtifactMark} from "../src/components/artifact-mark";
import
{
	ARTIFACT_MARK_KINDS,
	ARTIFACT_MARK_SIZES,
	coverBlankKind,
	resolveArtifactMark,
	type ArtifactMarkKind,
} from "../src/lib/artifact-mark";

afterEach(cleanup);

/** The glyph's px from its 1em box: upstream's cds Icon font-size `calc(<px/16>rem * var(--cds-rem-scale, 1))`. */
function glyphPx(svg: SVGElement | null): number | undefined
{
	const match = /^calc\(([\d.]+)rem/.exec(svg?.style.fontSize ?? "");
	return match === null ? undefined : Number(match[1]) * 16;
}

function describeMark(container: HTMLElement)
{
	const mark = container.querySelector<HTMLElement>("[data-artifact-mark]");
	const svg = mark?.querySelector("svg") ?? null;
	return {
		kind: mark?.dataset["artifactMark"],
		size: mark?.dataset["artifactMarkSize"],
		className: mark?.className,
		svgSize: glyphPx(svg),
	};
}

const TILE_TONES: Record<ArtifactMarkKind, string> =
{
	document: "bg-tint-blue text-tint-blue",
	slides: "bg-tint-orange text-tint-orange",
	design: "bg-tint-violet text-tint-violet",
	chart: "bg-tint-red text-tint-red",
	animation: "bg-tint-aqua text-tint-aqua",
	web: "bg-tint-yellow text-tint-yellow",
	video: "bg-tint-magenta text-tint-magenta",
	code: "bg-fill-secondary text-secondary",
	image: "bg-tint-red text-tint-red",
	diagram: "bg-tint-green text-tint-green",
	file: "bg-fill-secondary text-secondary",
};

const INKS: Record<ArtifactMarkKind, string> =
{
	document: "text-tint-blue",
	slides: "text-tint-orange",
	design: "text-tint-violet",
	chart: "text-tint-red",
	animation: "text-tint-aqua",
	web: "text-tint-yellow",
	video: "text-tint-magenta",
	code: "text-secondary",
	image: "text-tint-red",
	diagram: "text-tint-green",
	file: "text-secondary",
};

describe("ArtifactMark", () =>
{
	it("draws upstream's n8 for every kind and size: tinted tiles at card/row, bare tinted glyphs at menu sizes", () =>
	{
		const kinds = Object.keys(ARTIFACT_MARK_KINDS) as ArtifactMarkKind[];
		const sizes = Object.keys(ARTIFACT_MARK_SIZES) as (keyof typeof ARTIFACT_MARK_SIZES)[];
		const actual = kinds.flatMap((kind) =>
			sizes.map((size) =>
			{
				const {container} = render(<ArtifactMark kind={kind} size={size} />);
				const described = describeMark(container);
				cleanup();
				return described;
			}),
		);
		const expected = kinds.flatMap((kind) => [
			{
				kind,
				size: "card",
				className: `flex items-center justify-center size-10 shrink-0 overflow-hidden rounded-lg ${TILE_TONES[kind]}`,
				svgSize: 20,
			},
			{
				kind,
				size: "row",
				className: `flex items-center justify-center size-7 shrink-0 overflow-hidden rounded-[25%] ${TILE_TONES[kind]}`,
				svgSize: 16,
			},
			{
				kind,
				size: "menu",
				className: `flex shrink-0 items-center justify-center ${INKS[kind]}`,
				svgSize: 20,
			},
			{
				kind,
				size: "menu-small",
				className: `flex shrink-0 items-center justify-center ${INKS[kind]}`,
				svgSize: 16,
			},
		]);
		expect(actual).toStrictEqual(expected);
	});

	it("defaults to the row size and hides its glyph unless labelled, when it becomes role=img", () =>
	{
		const plain = render(<ArtifactMark kind="slides" />);
		const plainSvg = plain.container.querySelector("svg");
		const plainState =
		{
			size: plain.container.querySelector("[data-artifact-mark]")?.getAttribute("data-artifact-mark-size"),
			hidden: plainSvg?.getAttribute("aria-hidden"),
			role: plainSvg?.getAttribute("role"),
		};
		cleanup();
		const labelled = render(<ArtifactMark kind="document" label="Docs" />);
		const svg = labelled.container.querySelector("svg");
		expect(
			{
				plain: plainState,
				labelled:
				{
					hidden: svg?.getAttribute("aria-hidden"),
					role: svg?.getAttribute("role"),
					label: svg?.getAttribute("aria-label"),
				},
			},
		).toStrictEqual(
			{
				plain:
				{
					size: "row",
					hidden: "true",
					role: null,
				},
				labelled:
				{
					hidden: null,
					role: "img",
					label: "Docs",
				},
			},
		);
	});

	it("swaps the glyph for an md current-colour spinner when busy, keeping the box and ink", () =>
	{
		const {container} = render(<ArtifactMark kind="document" size="row" busy />);
		const mark = container.querySelector<HTMLElement>("[data-artifact-mark]");
		expect(
			{
				size: mark?.dataset["artifactMarkSize"],
				className: mark?.className,
				glyphs: mark?.querySelectorAll("svg").length,
				spinners: mark?.querySelectorAll("[data-spinner]").length,
				spinnerBox: mark?.querySelector<HTMLElement>("[data-spinner]")?.style.width,
			},
		).toStrictEqual(
			{
				size: "row",
				className:
					"flex items-center justify-center size-7 shrink-0 overflow-hidden rounded-[25%] bg-tint-blue text-tint-blue",
				glyphs: 0,
				spinners: 1,
				spinnerBox: "1rem",
			},
		);
	});

	it("draws a file mark's declared glyph in place of the Artifacts glyph, and ignores it for other kinds", () =>
	{
		const file = render(<ArtifactMark kind="file" size="card" glyph="Calendar" />);
		const fileSvg = file.container.querySelector("svg");
		const fileState =
		{
			glyph: fileSvg?.getAttribute("class")?.includes("lucide-calendar"),
			px: glyphPx(fileSvg),
		};
		cleanup();
		const doc = render(<ArtifactMark kind="document" size="card" glyph="Calendar" />);
		expect(
			{
				file: fileState,
				document: doc.container.querySelector("svg")?.getAttribute("class")?.includes("lucide-calendar"),
			},
		).toStrictEqual(
			{
				file:
				{
					glyph: true,
					px: 20,
				},
				document: false,
			},
		);
	});
});

describe("resolveArtifactMark", () =>
{
	it("ports upstream's $A/y8/PO: type kind, then type name, then a typed artifact's glyph word, else file", () =>
	{
		expect(
			{
				docs: resolveArtifactMark(
					{
						typeKind: "docs",
					},
				),
				html: resolveArtifactMark(
					{
						typeKind: "html",
					},
				),
				dashboard: resolveArtifactMark(
					{
						typeName: " Dashboard ",
					},
				),
				webApp: resolveArtifactMark(
					{
						typeName: "Web app",
					},
				),
				designSystem: resolveArtifactMark(
					{
						typeName: "Design System",
					},
				),
				motion: resolveArtifactMark(
					{
						typeName: "motion",
					},
				),
				untypedWord: resolveArtifactMark(
					{
						iconWord: "code",
					},
				),
				untyped: resolveArtifactMark({}),
				unknownName: resolveArtifactMark(
					{
						typeName: "Unknown",
					},
				),
				typedWord: resolveArtifactMark(
					{
						typeName: "Unknown",
						iconWord: "chart",
					},
				),
				typedPascalWord: resolveArtifactMark(
					{
						typeName: "Unknown",
						iconWord: "PlayCircle",
					},
				),
			},
		).toStrictEqual(
			{
				docs:
				{
					kind: "document",
					hue: "blue",
				},
				html: undefined,
				dashboard:
				{
					kind: "chart",
					hue: "red",
				},
				webApp:
				{
					kind: "web",
					hue: "yellow",
				},
				designSystem:
				{
					kind: "design",
					hue: "violet",
				},
				motion:
				{
					kind: "animation",
					hue: "aqua",
				},
				untypedWord: undefined,
				untyped: undefined,
				unknownName:
				{
					kind: "file",
					hue: "gray",
				},
				typedWord:
				{
					kind: "chart",
					hue: "red",
				},
				typedPascalWord:
				{
					kind: "animation",
					hue: "aqua",
				},
			},
		);
	});
});

describe("coverBlankKind", () =>
{
	// Upstream c33ae67d6 `z()` drops an untyped, untinted publish's icon before the blank-kind pick.
	it("never lets an untyped publish's icon word pick a blank drawing", () =>
	{
		expect(
			[
				{
					kind: "html",
					icon: "chart",
				},
				{
					kind: "html",
					icon: "palette",
				},
				{
					kind: "html",
					icon: "document",
				},
				{
					kind: "html",
					icon: null,
				},
				{
					kind: "docs",
					icon: null,
				},
			].map((artifact) => coverBlankKind(artifact as Parameters<typeof coverBlankKind>[0])),
		).toStrictEqual(["other", "other", "other", "other", "document"]);
	});
});
