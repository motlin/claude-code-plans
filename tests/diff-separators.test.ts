// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	SHOW_MORE_LINES,
	expandSeparatorFromClick,
	relabelTrailingSeparator,
} from "../src/components/changes/diff-separators";

function hostWith(html: string): HTMLElement
{
	const host = document.createElement("div");
	host.attachShadow(
		{
			mode: "open",
		},
	).innerHTML = html;
	document.body.append(host);
	return host;
}

const TRAILING = (text: string) =>
	`<div data-separator="line-info" data-separator-last><div data-separator-wrapper><div data-separator-content><span data-unmodified-lines>${text}</span></div></div></div>`;

describe("relabelTrailingSeparator (upstream c91a5e4a6 o)", () =>
{
	afterEach(() =>
	{
		document.body.replaceChildren();
	});

	it("relabels only the trailing separator's unknown-count copy, idempotently", () =>
	{
		const labels = (host: HTMLElement) =>
			[...(host.shadowRoot?.querySelectorAll("[data-unmodified-lines]") ?? [])].map((label) => label.textContent);
		const unknown = hostWith(
			`${TRAILING("More unchanged context may be available")}<div data-separator="line-info"><span data-unmodified-lines>More unchanged context may be available</span></div>`,
		);
		const counted = hostWith(TRAILING("18 unmodified lines"));

		relabelTrailingSeparator(unknown, SHOW_MORE_LINES);
		relabelTrailingSeparator(unknown, SHOW_MORE_LINES);
		relabelTrailingSeparator(counted, SHOW_MORE_LINES);

		expect(
			{
				unknown: labels(unknown),
				counted: labels(counted),
				copy: SHOW_MORE_LINES,
			},
		).toStrictEqual(
			{
				unknown: ["Show more lines", "More unchanged context may be available"],
				counted: ["18 unmodified lines"],
				copy: "Show more lines",
			},
		);
	});
});

describe("expandSeparatorFromClick (upstream c91a5e4a6 i)", () =>
{
	afterEach(() =>
	{
		vi.restoreAllMocks();
		document.body.replaceChildren();
	});

	const BOTH = `<div data-separator="line-info"><div data-separator-wrapper><div role="button" data-expand-button data-expand-up></div><div role="button" data-expand-button data-expand-down></div><div data-separator-content><span data-unmodified-lines>3 unmodified lines</span></div></div></div>`;
	const CHUNKED = `<div data-separator="line-info"><div data-separator-wrapper data-separator-multi-button><div role="button" data-expand-button data-expand-up></div><div role="button" data-expand-button data-expand-down></div><div data-separator-content><span data-unmodified-lines>300 unmodified lines</span></div><div role="button" data-expand-button data-expand-all-button>Expand all</div></div></div>`;

	/** Clicks `selector` inside a fresh host and returns the expand attributes of every element `.click()`ed by the handler. */
	function clicked(html: string, selector: string): string[]
	{
		const host = hostWith(html);
		const target = host.shadowRoot?.querySelector(selector) ?? host;
		const names: string[] = [];
		host.addEventListener("click", (event) =>
		{
			const spy = vi.spyOn(HTMLElement.prototype, "click").mockImplementation(function (this: HTMLElement)
			{
				names.push(
					[...this.attributes]
						.map((attribute) => attribute.name)
						.filter((name) => name.startsWith("data-expand-") && name !== "data-expand-button")
						.join(" "),
				);
			});
			expandSeparatorFromClick(event);
			spy.mockRestore();
		});
		target.dispatchEvent(
			new MouseEvent(
				"click",
				{
					bubbles: true,
					composed: true,
				},
			),
		);
		return names;
	}

	it("clicks every expand button in the separator whose label was clicked", () =>
	{
		expect(
			{
				both: clicked(BOTH, "[data-unmodified-lines]"),
				chunked: clicked(CHUNKED, "[data-separator-content]"),
			},
		).toStrictEqual(
			{
				both: ["data-expand-up", "data-expand-down"],
				chunked: ["data-expand-up", "data-expand-down", "data-expand-all-button"],
			},
		);
	});

	it("clicks nothing extra for a click on a button itself or outside any separator", () =>
	{
		expect(
			{
				button: clicked(BOTH, "[data-expand-down]"),
				outside: clicked(`<div data-line="1">x</div>`, "[data-line]"),
			},
		).toStrictEqual(
			{
				button: [],
				outside: [],
			},
		);
	});
});
