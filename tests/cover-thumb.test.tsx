// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {CoverThumb} from "../src/components/cover-thumb";

afterEach(cleanup);

function thumbImg(): HTMLImageElement
{
	const img = document.querySelector("img");
	if (img === null) throw new Error("no thumb img");
	return img;
}

function describeImg()
{
	const img = document.querySelector("img");
	return img === null
		? null
		: Object.fromEntries([...img.attributes].map((attribute) => [attribute.name, attribute.value]));
}

describe("CoverThumb", () =>
{
	it("renders upstream's thumb img: empty alt, no referrer, async decoding, the passed loading and priority", () =>
	{
		render(
			<CoverThumb
				src="/thumb-a.png"
				fallback={<span data-testid="fallback" />}
				imgClassName="block w-full"
				loading="eager"
				fetchPriority="high"
			/>,
		);

		expect(describeImg()).toStrictEqual(
			{
				alt: "",
				src: "/thumb-a.png",
				referrerpolicy: "no-referrer",
				loading: "eager",
				fetchpriority: "high",
				decoding: "async",
				class: "block w-full",
			},
		);
	});

	it("defaults the img class to upstream's h-full w-full object-cover", () =>
	{
		render(<CoverThumb src="/thumb-a.png" fallback={null} loading="lazy" />);

		expect(describeImg()).toStrictEqual(
			{
				alt: "",
				src: "/thumb-a.png",
				referrerpolicy: "no-referrer",
				loading: "lazy",
				decoding: "async",
				class: "h-full w-full object-cover",
			},
		);
	});

	it("replaces a failing img with the fallback and reports the error once", () =>
	{
		const onError = vi.fn<() => void>();
		render(<CoverThumb src="/thumb-a.png" fallback={<span data-testid="fallback" />} onError={onError} />);

		fireEvent.error(thumbImg());

		expect(
			{
				img: document.querySelector("img"),
				fallback: screen.queryByTestId("fallback") !== null,
				errors: onError.mock.calls.length,
			},
		).toStrictEqual(
			{
				img: null,
				fallback: true,
				errors: 1,
			},
		);
	});

	it("tries fallbackSrc after the first error and shows the fallback only after it fails too", () =>
	{
		const onError = vi.fn<() => void>();
		render(
			<CoverThumb
				src="/thumb-dark.png"
				fallbackSrc="/thumb-light.png"
				fallback={<span data-testid="fallback" />}
				onError={onError}
			/>,
		);

		fireEvent.error(thumbImg());
		const afterFirst =
		{
			src: document.querySelector("img")?.getAttribute("src"),
			errors: onError.mock.calls.length,
		};
		fireEvent.error(thumbImg());

		expect(
			{
				afterFirst,
				afterSecond:
				{
					img: document.querySelector("img"),
					fallback: screen.queryByTestId("fallback") !== null,
					errors: onError.mock.calls.length,
				},
			},
		).toStrictEqual(
			{
				afterFirst:
				{
					src: "/thumb-light.png",
					errors: 0,
				},
				afterSecond:
				{
					img: null,
					fallback: true,
					errors: 1,
				},
			},
		);
	});

	it("reports which source loaded", () =>
	{
		const onLoad = vi.fn<(which: "src" | "fallback") => void>();
		render(<CoverThumb src="/thumb-dark.png" fallbackSrc="/thumb-light.png" fallback={null} onLoad={onLoad} />);

		fireEvent.load(thumbImg());
		fireEvent.error(thumbImg());
		fireEvent.load(thumbImg());

		expect(onLoad.mock.calls).toStrictEqual([["src"], ["fallback"]]);
	});
});
