import {describe, expect, it} from "vite-plus/test";
import {follow, rawAt, release, rubber, SHEET_DRAG, sheetGeometry, unrubber} from "../src/lib/sheet-drag";

/** A 489px menu sheet that cannot grow (upstream zeroes the room when `!canGrow`). */
const FIXED = {rest: 489, tall: 489, room: 0};
/** A 300px sheet that can grow to a 720px tall detent with 40px of overshoot room. */
const GROWABLE = {rest: 300, tall: 720, room: 40};

describe("sheet drag constants", () => {
	it("copies upstream's d6", () => {
		expect(SHEET_DRAG).toStrictEqual({
			detentThreshold: 40,
			dismissFraction: 0.25,
			flingVelocity: 0.8,
			rubberBand: 0.55,
			overshootRoom: 0.5,
		});
	});
});

describe("rubber / unrubber", () => {
	it("bands overshoot as upstream's fb and inverts it as H3", () => {
		expect([
			rubber(100, 50).toFixed(2),
			rubber(0, 50),
			rubber(100, 0),
			unrubber(rubber(100, 50), 50).toFixed(2),
			unrubber(0, 50),
			unrubber(10, 0),
		]).toStrictEqual(["26.19", 0, 0, "100.00", 0, 0]);
	});
});

describe("sheetGeometry", () => {
	it("derives rest, tall and room as upstream's so", () => {
		expect([
			sheetGeometry(300, 800, 0.9),
			sheetGeometry(489, 800, 0.9, false),
			sheetGeometry(700, 800, 0.9),
		]).toStrictEqual([
			{rest: 300, tall: 720, room: 40},
			{rest: 489, tall: 489, room: 155.5},
			{rest: 700, tall: 700, room: 50},
		]);
	});
});

describe("follow", () => {
	it("bands above tall, grows between rest and tall, and slides below rest, as upstream's _1", () => {
		expect([
			follow(GROWABLE, 820),
			follow(GROWABLE, 500),
			follow(GROWABLE, 200),
			follow(GROWABLE, -100),
		]).toStrictEqual([
			{height: 720 + rubber(100, 40), slide: 0, shown: 1},
			{height: 500, slide: 0, shown: 1},
			{height: 300, slide: 100, shown: 1 - 100 / 300},
			{height: 300, slide: 400, shown: 0},
		]);
	});
});

describe("rawAt", () => {
	it("maps a grabbed height back to the raw finger position, as upstream's c8", () => {
		expect([
			rawAt(GROWABLE, 400, 0),
			rawAt(GROWABLE, 300, 20),
			rawAt(GROWABLE, 720 + rubber(100, 40), 0).toFixed(2),
		]).toStrictEqual([400, 280, "820.00"]);
	});
});

describe("release", () => {
	function fixedRelease(slide: number, velocity: number, msSinceMove = 16) {
		return release(FIXED, {
			detent: "default",
			rawAtGrab: 489,
			rawAtRelease: 489 - slide,
			caughtSlide: 0,
			velocity,
			msSinceMove,
			commit: true,
		});
	}

	it("dismisses past a quarter of the rest height or on a fling, as upstream's d$", () => {
		expect([
			fixedRelease(100, 0),
			fixedRelease(130, 0),
			fixedRelease(20, 1.0),
			fixedRelease(20, 1.0, 150),
			release(FIXED, {
				detent: "default",
				rawAtGrab: 489,
				rawAtRelease: 289,
				caughtSlide: 0,
				velocity: 1.0,
				msSinceMove: 16,
				commit: false,
			}),
			release(FIXED, {
				detent: "default",
				rawAtGrab: 449,
				rawAtRelease: 349,
				caughtSlide: 40,
				velocity: 0,
				msSinceMove: 16,
				commit: true,
			}),
		]).toStrictEqual([
			{dismiss: false, detent: "default"},
			{dismiss: true, detent: "default"},
			{dismiss: true, detent: "default"},
			{dismiss: false, detent: "default"},
			{dismiss: false, detent: "default"},
			{dismiss: false, detent: "default"},
		]);
	});

	it("flings only from the default detent", () => {
		expect(
			release(GROWABLE, {
				detent: "tall",
				rawAtGrab: 720,
				rawAtRelease: 690,
				caughtSlide: 0,
				velocity: 1.0,
				msSinceMove: 16,
				commit: true,
			}),
		).toStrictEqual({dismiss: false, detent: "tall"});
	});

	it("moves between the default and tall detents past the 40px threshold", () => {
		function growable(detent: "default" | "tall", rawAtGrab: number, rawAtRelease: number) {
			return release(GROWABLE, {
				detent,
				rawAtGrab,
				rawAtRelease,
				caughtSlide: 0,
				velocity: 0,
				msSinceMove: 16,
				commit: true,
			});
		}
		expect([
			growable("default", 300, 360),
			growable("default", 300, 330),
			growable("tall", 720, 650),
			growable("tall", 720, 700),
			growable("default", 400, 450),
			growable("tall", 400, 350),
			growable("default", 400, 420),
		]).toStrictEqual([
			{dismiss: false, detent: "tall"},
			{dismiss: false, detent: "default"},
			{dismiss: false, detent: "default"},
			{dismiss: false, detent: "tall"},
			{dismiss: false, detent: "tall"},
			{dismiss: false, detent: "default"},
			{dismiss: false, detent: "default"},
		]);
	});

	it("never moves to tall when the sheet cannot grow", () => {
		expect(
			release(FIXED, {
				detent: "default",
				rawAtGrab: 489,
				rawAtRelease: 600,
				caughtSlide: 0,
				velocity: 0,
				msSinceMove: 16,
				commit: true,
			}),
		).toStrictEqual({dismiss: false, detent: "default"});
	});
});
