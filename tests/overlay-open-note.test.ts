import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	noteOverlayOpening,
	OVERLAY_OPEN_DELAY_MS,
	OVERLAY_OPEN_NOTE_WINDOW_MS,
	runAfterOverlayDelay,
	takeOverlayOpeningNote,
} from "../src/lib/overlay-open-note";

describe("overlay-open note (upstream X7 / NM / m7)", () =>
{
	beforeEach(() =>
	{
		vi.useFakeTimers();
		takeOverlayOpeningNote();
	});

	afterEach(() =>
	{
		vi.useRealTimers();
	});

	it("copies upstream's constants", () =>
	{
		expect(
			{
				delay: OVERLAY_OPEN_DELAY_MS,
				window: OVERLAY_OPEN_NOTE_WINDOW_MS,
			},
		).toStrictEqual(
			{
				delay: 100,
				window: 500,
			},
		);
	});

	it("hands a note to the first take only", () =>
	{
		noteOverlayOpening(250);

		expect([takeOverlayOpeningNote(), takeOverlayOpeningNote()]).toStrictEqual([250, null]);
	});

	it("drops a note taken 500ms or later", () =>
	{
		noteOverlayOpening(100);
		vi.advanceTimersByTime(499);
		expect(takeOverlayOpeningNote()).toBe(100);

		noteOverlayOpening(100);
		vi.advanceTimersByTime(500);
		expect(takeOverlayOpeningNote()).toBeNull();
	});

	it("notes 100ms and runs the opener 100ms later for a dialog", () =>
	{
		const open = vi.fn<() => void>();

		runAfterOverlayDelay(open, "dialog");

		expect(open).not.toHaveBeenCalled();
		vi.advanceTimersByTime(99);
		expect(open).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(open).toHaveBeenCalledTimes(1);
		expect(takeOverlayOpeningNote()).toBe(100);
	});

	it("delays without a note for any other overlay", () =>
	{
		const open = vi.fn<() => void>();

		runAfterOverlayDelay(open);

		expect(takeOverlayOpeningNote()).toBeNull();
		vi.advanceTimersByTime(100);
		expect(open).toHaveBeenCalledTimes(1);
	});
});
