// @vitest-environment jsdom

import {describe, expect, it} from "vite-plus/test";
import {svgWithheld} from "../src/lib/mermaid-svg-audit";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Built up so the private key hook does not see a key header in this file. */
const DASHES = "-".repeat(5);
const KEY_KIND = ["RSA", "PRIVATE", "KEY"].join(" ");

/** A host div holding `<svg>` built from `markup`, the way a diagram layer holds its drawing. */
function layer(markup: string): HTMLElement
{
	const host = document.createElement("div");
	host.innerHTML = `<svg xmlns="${SVG_NS}">${markup}</svg>`;
	return host;
}

function tspans(count: number): string
{
	return `<text>${Array.from(
		{
			length: count,
		},
		() => "<tspan>x</tspan>",
	).join("")}</text>`;
}

function shadowHost(markup: string): HTMLElement
{
	const outer = document.createElement("div");
	const host = document.createElement("div");
	outer.append(host);
	host.attachShadow(
		{
			mode: "open",
		},
	).innerHTML = `<svg xmlns="${SVG_NS}">${markup}</svg>`;
	return outer;
}

describe("svgWithheld (upstream c9e4d0c57 post-draw audit)", () =>
{
	it("withholds drawings that are missing, hold a secret, or bend glyphs, and passes clean ones", () =>
	{
		const fakeToken = `ghp_${"x".repeat(36)}`;
		const cases: [string, HTMLElement | null][] = [
			["null", null],
			[
				"no svg",
				Object.assign(
					document.createElement("div"),
					{
						innerHTML: "<p>Start</p>",
					},
				),
			],
			["clean", layer("<text>Start</text>")],
			["token in one label", layer(`<text>${fakeToken}</text>`)],
			[
				"token split across two labels",
				layer(`<text>ghp_${"x".repeat(16)}</text><text>${"x".repeat(20)}</text>`),
			],
			[
				"token split across two tspans",
				layer(`<text><tspan>ghp_${"x".repeat(16)}</tspan><tspan>${"x".repeat(20)}</tspan></text>`),
			],
			["32 tspans without a separator", layer(tspans(32))],
			["33 tspans without a separator", layer(tspans(33))],
			["private key header", layer(`<text>${DASHES}BEGIN ${KEY_KIND}${DASHES}</text>`)],
			["bidi override", layer("<text>Start‮end</text>")],
			["replacement char", layer("<text>Start�</text>")],
			["control picture", layer("<text>Start␀</text>")],
			["style direction", layer("<style>text{direction:rtl}</style><text>Start</text>")],
			["style text-transform", layer("<style>text{text-transform:uppercase}</style><text>Start</text>")],
			["style comment", layer("<style>text{fill:red/* x */}</style><text>Start</text>")],
			["negative letter-spacing", layer('<text style="letter-spacing:-1px">Start</text>')],
			["direction attribute", layer('<text direction="rtl">Start</text>')],
			["word-spacing attribute", layer('<text word-spacing="-2">Start</text>')],
			["plain fill style", layer("<style>text{fill:red}</style><text>Start</text>")],
			["token in a shadow root", shadowHost(`<text>${fakeToken}</text>`)],
			["clean shadow root", shadowHost("<text>Start</text>")],
		];
		expect(cases.map(([name, root]) => [name, svgWithheld(root)])).toStrictEqual([
			["null", true],
			["no svg", true],
			["clean", false],
			["token in one label", true],
			["token split across two labels", true],
			["token split across two tspans", true],
			["32 tspans without a separator", false],
			["33 tspans without a separator", true],
			["private key header", true],
			["bidi override", true],
			["replacement char", true],
			["control picture", true],
			["style direction", true],
			["style text-transform", true],
			["style comment", true],
			["negative letter-spacing", true],
			["direction attribute", true],
			["word-spacing attribute", true],
			["plain fill style", false],
			["token in a shadow root", true],
			["clean shadow root", false],
		]);
	});

	it("ignores script text and does not count labels nested inside another label twice", () =>
	{
		expect([
			svgWithheld(layer(`<script>ghp_${"x".repeat(36)}</script><text>Start</text>`)),
			svgWithheld(layer("<text>Start<title>End</title></text>")),
		]).toStrictEqual([false, false]);
	});
});
