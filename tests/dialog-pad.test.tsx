// @vitest-environment jsdom

import {renderHook} from "@testing-library/react";
import {describe, expect, it} from "vite-plus/test";

import {DIALOG_FOOTER_CLASS, useDialogPad} from "../src/components/ui/dialog-pad";
import {PanelsOff} from "./fizzy-lake-off";

const PAD_16 = {
	p: "p-4",
	mx: "-mx-4",
	mb: "-mb-4",
	mt: "-mt-4",
	px: "px-4",
	pb: "pb-4",
	scrollMb: "last:scroll-mb-4",
	maxHList: "max-h-[calc(50vh+16px)]",
};

describe("useDialogPad (upstream js: _z under panels, Xn p-xl otherwise)", () => {
	it("returns the 16px set and the panels popup markers with default parts", () => {
		const {result} = renderHook(() => useDialogPad());
		expect(result.current).toStrictEqual({popup: {"data-cds": "Dialog", "data-cds-fizzy": ""}, ...PAD_16});
	});

	it("returns the 24px set with panels off", () => {
		const {result} = renderHook(() => useDialogPad(), {wrapper: PanelsOff});
		expect(result.current).toStrictEqual({
			popup: {"data-cds": "Dialog", "data-cds-fizzy": undefined},
			p: "p-6",
			mx: "-mx-6",
			mb: "-mb-6",
			mt: "-mt-6",
			px: "px-6",
			pb: "pb-6",
			scrollMb: "last:scroll-mb-6",
			maxHList: "max-h-[calc(50vh+24px)]",
		});
	});

	it("returns the 20px set for a compact-origin dialog with panels off, and 16px under panels", () => {
		const off = renderHook(() => useDialogPad({compactOrigin: true}), {wrapper: PanelsOff}).result.current;
		const on = renderHook(() => useDialogPad({compactOrigin: true})).result.current;
		expect({off, on}).toStrictEqual({
			off: {
				popup: {"data-cds": "Dialog", "data-cds-fizzy": undefined},
				p: "p-5",
				mx: "-mx-5",
				mb: "-mb-5",
				mt: "-mt-5",
				px: "px-5",
				pb: "pb-5",
				scrollMb: "last:scroll-mb-5",
				maxHList: "max-h-[calc(50vh+20px)]",
			},
			on: {popup: {"data-cds": "Dialog", "data-cds-fizzy": ""}, ...PAD_16},
		});
	});

	it("exports upstream RQ's 16px footer", () => {
		expect(DIALOG_FOOTER_CLASS).toBe("mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end");
	});
});
