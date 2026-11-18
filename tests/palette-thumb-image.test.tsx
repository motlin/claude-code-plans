// @vitest-environment jsdom

import {cleanup, fireEvent, render, renderHook, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {PaletteThumbImage} from "../src/components/palette-thumb-image";
import {isThumbLoaded, useUsableThumb} from "../src/lib/palette-thumb-store";

afterEach(cleanup);

function image()
{
	return screen.getByTestId("palette-thumb-image");
}

describe("PaletteThumbImage", () =>
{
	it("renders upstream's palette thumb img", () =>
	{
		render(
			<PaletteThumbImage
				thumb={
				{
					src: "/api/artifacts/a-attrs/thumbnail?v=1",
				}}
			/>,
		);

		expect(
			Object.fromEntries([...image().attributes].map((attribute) => [attribute.name, attribute.value])),
		).toStrictEqual(
			{
				alt: "",
				src: "/api/artifacts/a-attrs/thumbnail?v=1",
				referrerpolicy: "no-referrer",
				decoding: "sync",
				draggable: "false",
				"data-testid": "palette-thumb-image",
				class: "block aspect-[16/10] w-full rounded object-cover object-top",
			},
		);
	});

	it("records a load and reports it", () =>
	{
		const thumb =
		{
			src: "/api/artifacts/a-load/thumbnail?v=1",
		};
		const onLoaded = vi.fn<() => void>();
		render(<PaletteThumbImage thumb={thumb} onLoaded={onLoaded} />);

		fireEvent.load(image());

		expect(
			{
				loaded: onLoaded.mock.calls.length,
				known: isThumbLoaded(thumb),
			},
		).toStrictEqual(
			{
				loaded: 1,
				known: true,
			},
		);
	});

	it("falls back to the light src once, then fails the thumb for good", () =>
	{
		const thumb =
		{
			src: "/api/artifacts/a-fail/thumbnail-dark?v=1",
			fallbackSrc: "/api/artifacts/a-fail/thumbnail?v=1",
		};
		const onFailed = vi.fn<() => void>();
		const usable = renderHook(() => useUsableThumb(thumb));
		render(<PaletteThumbImage thumb={thumb} onFailed={onFailed} />);

		fireEvent.error(image());
		const afterFirst =
		{
			src: image().getAttribute("src"),
			failed: onFailed.mock.calls.length,
			usable: usable.result.current,
		};
		fireEvent.error(image());

		expect(
			{
				afterFirst,
				failed: onFailed.mock.calls.length,
				usable: usable.result.current,
				img: screen.queryByTestId("palette-thumb-image"),
			},
		).toStrictEqual(
			{
				afterFirst:
				{
					src: "/api/artifacts/a-fail/thumbnail?v=1",
					failed: 0,
					usable: thumb,
				},
				failed: 1,
				usable: undefined,
				img: null,
			},
		);
	});

	it("fails a thumb without a fallback on its first error", () =>
	{
		const thumb =
		{
			src: "/api/artifacts/a-once/thumbnail?v=1",
		};
		const onFailed = vi.fn<() => void>();
		render(<PaletteThumbImage thumb={thumb} onFailed={onFailed} />);

		fireEvent.error(image());

		expect(
			{
				failed: onFailed.mock.calls.length,
				usable: renderHook(() => useUsableThumb(thumb)).result.current,
			},
		).toStrictEqual(
			{
				failed: 1,
				usable: undefined,
			},
		);
	});
});
