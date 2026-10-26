import {describe, expect, it} from "vite-plus/test";
import {
	FOOTER_LAYOUT_CASES,
	footerLayoutFailures,
	parseFooterLayoutArgs,
	type FooterMeasurement,
} from "../scripts/palette-footer-layout";

const phoneFit: FooterMeasurement = {
	height: 40.5,
	scrollWidth: 357,
	clientWidth: 357,
	hints: [
		{label: "Close", height: 18},
		{label: "Actions", height: 18},
	],
	viewHint: "Compose",
};

describe("FOOTER_LAYOUT_CASES", () => {
	it("pins upstream's visible hints at phone, below-md and desktop widths", () => {
		expect(FOOTER_LAYOUT_CASES).toStrictEqual([
			{width: 390, height: 844, labels: ["Close", "Actions", "Compose"]},
			{width: 700, height: 844, labels: ["Close", "Change type", "Actions", "Compose"]},
			{width: 1200, height: 844, labels: ["Close", "Change type", "Filters", "Actions", "Compose"]},
		]);
	});
});

describe("footerLayoutFailures", () => {
	it("passes upstream's one-line 390px footer", () => {
		expect(footerLayoutFailures(phoneFit, ["Close", "Actions", "Compose"])).toStrictEqual([]);
	});

	it("tolerates half a pixel of footer height", () => {
		expect(footerLayoutFailures({...phoneFit, height: 40.9}, ["Close", "Actions", "Compose"])).toStrictEqual([]);
	});

	it("reports the wrapped, overflowing pre-fix phone footer", () => {
		const wrapped: FooterMeasurement = {
			height: 52.5,
			scrollWidth: 388,
			clientWidth: 357,
			hints: [
				{label: "Close", height: 18},
				{label: "Change type", height: 32},
				{label: "Filters", height: 18},
				{label: "Actions", height: 18},
			],
			viewHint: null,
		};

		expect(footerLayoutFailures(wrapped, ["Close", "Actions", "Compose"])).toStrictEqual([
			"footer height 52.5px, expected 40.5px (±0.5)",
			"footer overflows: scrollWidth 388 > clientWidth 357",
			'visible hints ["Close","Change type","Filters","Actions"], expected ["Close","Actions","Compose"]',
			'hint "Change type" is 32px tall, expected 18px',
		]);
	});
});

describe("parseFooterLayoutArgs", () => {
	it("defaults to the dev server on 7526", () => {
		expect(parseFooterLayoutArgs([])).toStrictEqual({baseUrl: "http://127.0.0.1:7526"});
	});

	it("accepts another server's base URL without a trailing slash", () => {
		expect(parseFooterLayoutArgs(["--base-url", "http://127.0.0.1:7600/"])).toStrictEqual({
			baseUrl: "http://127.0.0.1:7600",
		});
	});

	it("rejects unknown arguments", () => {
		expect(() => parseFooterLayoutArgs(["--port", "7600"])).toThrow("Unknown argument: --port");
	});
});
