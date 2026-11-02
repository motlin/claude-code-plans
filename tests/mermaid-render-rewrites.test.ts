// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";
import
{
	dimUnreadableSequenceBands,
	readableStyleColors,
	sequenceDollarsAsEntities,
	textColorOf,
} from "../src/lib/mermaid-render";

/* Upstream's source rewrites before a draw (shared-41 `c$`, `Us`) and its band fix after one (`cx`). */

describe("sequenceDollarsAsEntities (upstream c$)", () =>
{
	it("writes every $ of a sequence diagram as mermaid's own encoded #36; entity, which it decodes back to $", () =>
	{
		expect(sequenceDollarsAsEntities("sequenceDiagram\nA->>B: costs $5 or $$x$$")).toBe(
			"sequenceDiagram\nA->>B: costs ﬂ°°36¶ß5 or ﬂ°°36¶ßﬂ°°36¶ßxﬂ°°36¶ßﬂ°°36¶ß",
		);
		expect(sequenceDollarsAsEntities("seq;uence;Diagram\nA->>B: $1")).toBe("seq;uence;Diagram\nA->>B: ﬂ°°36¶ß1");
		expect(sequenceDollarsAsEntities("graph TD\nA[$5]")).toBe("graph TD\nA[$5]");
	});
});

describe("textColorOf (upstream W$)", () =>
{
	it("reads the node text colour, else the primary text colour", () =>
	{
		expect(
			{
				node: textColorOf(
					{
						themeVariables:
						{
							nodeTextColor: "#111111",
							primaryTextColor: "#222222",
						},
					},
				),
				primary: textColorOf(
					{
						themeVariables:
						{
							primaryTextColor: "#222222",
						},
					},
				),
				none: textColorOf({}),
			},
		).toStrictEqual(
			{
				node: "#111111",
				primary: "#222222",
				none: undefined,
			},
		);
	});
});

describe("readableStyleColors (upstream Us)", () =>
{
	it("gives a style line whose fill is unreadable under the theme's text the closer of near-black or near-white", () =>
	{
		expect(readableStyleColors("graph TD\nA-->B\nstyle A fill:#191919", "#191919", 20_000)).toBe(
			"graph TD\nA-->B\nstyle A fill:#191919,color:#F5F5F5",
		);
		expect(readableStyleColors("graph TD\nstyle A fill:#ffffff", "#191919", 20_000)).toBe(
			"graph TD\nstyle A fill:#ffffff",
		);
	});

	it("leaves lines that set their own colour, er diagrams, and results over the length limit alone", () =>
	{
		expect(readableStyleColors("graph TD\nstyle A fill:#191919,color:#F00", "#191919", 20_000)).toBe(
			"graph TD\nstyle A fill:#191919,color:#F00",
		);
		expect(readableStyleColors("erDiagram\nstyle A fill:#191919", "#191919", 20_000)).toBe(
			"erDiagram\nstyle A fill:#191919",
		);
		expect(readableStyleColors("graph TD\nstyle A fill:#191919", "#191919", 30)).toBe(
			"graph TD\nstyle A fill:#191919",
		);
		expect(readableStyleColors("graph TD\nstyle A fill:#191919", undefined, 20_000)).toBe(
			"graph TD\nstyle A fill:#191919",
		);
	});

	it("colours a classDef only when no style line sets a fill and its fill is unreadable", () =>
	{
		expect(readableStyleColors("graph TD\nclassDef dark fill:#191919", "#191919", 20_000)).toBe(
			"graph TD\nclassDef dark fill:#191919,color:#F5F5F5",
		);
		expect(
			readableStyleColors("graph TD\nclassDef dark fill:#191919\nstyle B fill:#202020", "#191919", 20_000),
		).toBe("graph TD\nclassDef dark fill:#191919\nstyle B fill:#202020,color:#F5F5F5");
	});
});

describe("dimUnreadableSequenceBands (upstream cx)", () =>
{
	it("thins a sequence rect band the text cannot be read on to 10% opacity", () =>
	{
		const svg = new DOMParser().parseFromString(
			[
				'<svg xmlns="http://www.w3.org/2000/svg">',
				'<rect class="rect" fill="#191919"></rect>',
				'<rect class="rect" fill="rgba(200, 200, 200, 0.05)"></rect>',
				'<rect class="rect" fill="#ffffff"></rect>',
				'<rect class="actor" fill="#191919"></rect>',
				"</svg>",
			].join(""),
			"image/svg+xml",
		).documentElement;
		dimUnreadableSequenceBands(svg, "#191919");
		expect([...svg.querySelectorAll("rect")].map((rect) => rect.getAttribute("fill"))).toStrictEqual([
			"rgba(25, 25, 25, 0.1)",
			"rgba(200, 200, 200, 0.05)",
			"#ffffff",
			"#191919",
		]);
	});
});
