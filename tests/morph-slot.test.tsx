// @vitest-environment jsdom

import {act, cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {MORPH_EASE, MORPH_ENTER_CLASS, MORPH_MS, MorphSlot} from "../src/components/ui/morph-slot";

interface FakeAnimation {
	element: Element;
	keyframes: Keyframe[];
	options: KeyframeAnimationOptions;
	finish: () => void;
	cancel: () => void;
	cancelled: boolean;
	finished: Promise<FakeAnimation>;
	playState: string;
	startTime: number | null;
	effect: {getComputedTiming: () => {progress: number | null}};
}

const FACE_CLASS = "col-start-1 row-start-1 flex min-w-0 max-w-full items-center group-data-[gliding]/morph:max-w-none";
const SLOT_CLASS = "group/morph inline-grid min-w-0 items-center justify-items-start data-[gliding]:overflow-x-clip";

let animations: FakeAnimation[] = [];
const widths = new Map<string, number>();

function installAnimate(): void {
	animations = [];
	HTMLElement.prototype.animate = function animate(
		this: HTMLElement,
		keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
		options?: number | KeyframeAnimationOptions,
	): Animation {
		let resolve: (value: FakeAnimation) => void = () => {};
		const finished = new Promise<FakeAnimation>((done) => {
			resolve = done;
		});
		const fake: FakeAnimation = {
			element: this,
			keyframes: keyframes as Keyframe[],
			options: options as KeyframeAnimationOptions,
			finished,
			cancelled: false,
			playState: "running",
			startTime: null,
			effect: {getComputedTiming: () => ({progress: 0})},
			finish: () => {
				fake.playState = "finished";
				resolve(fake);
			},
			cancel: () => {
				fake.cancelled = true;
				fake.playState = "idle";
			},
		};
		animations.push(fake);
		return fake as unknown as Animation;
	};
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
		const width = widths.get(this.getAttribute("data-morph-key") ?? "") ?? 0;
		return {
			width,
			height: 20,
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: width,
			bottom: 20,
			toJSON: () => ({}),
		};
	});
}

function faces(container: HTMLElement): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>("[data-morph-key]")];
}

function slotOf(container: HTMLElement): HTMLElement {
	const slot = container.querySelector<HTMLElement>("#row-label");
	if (slot === null) throw new Error("no slot");
	return slot;
}

function summary(container: HTMLElement): {key: string | null; hidden: string | null; text: string | null}[] {
	return faces(container).map((face) => ({
		key: face.getAttribute("data-morph-key"),
		hidden: face.getAttribute("aria-hidden"),
		text: face.textContent,
	}));
}

function Row({swapKey, text, attrs}: Readonly<{swapKey: string; text: string; attrs?: Record<string, string>}>) {
	return (
		<MorphSlot swapKey={swapKey} id="row-label" className="min-w-0 max-w-full" {...(attrs ? {attrs} : {})}>
			<span>{text}</span>
		</MorphSlot>
	);
}

describe("MorphSlot", () => {
	const original = HTMLElement.prototype.animate;

	beforeEach(() => {
		widths.clear();
		widths.set("busy|Reading", 80);
		widths.set("done|Read", 40);
		widths.set("done|Read again", 60);
		installAnimate();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		HTMLElement.prototype.animate = original;
		document.documentElement.removeAttribute("data-reduce-motion");
	});

	it("exports upstream's timing constants", () => {
		expect({MORPH_MS, MORPH_EASE, MORPH_ENTER_CLASS}).toStrictEqual({
			MORPH_MS: 180,
			MORPH_EASE: "cubic-bezier(0.2,0,0,1)",
			MORPH_ENTER_CLASS: "motion-safe:animate-[cds-morph-in_0.18s_cubic-bezier(.2,0,0,1)]",
		});
	});

	it("mounts a single face with no animation or glide", () => {
		const {container} = render(<Row swapKey="busy|Reading" text="Reading" />);
		const slot = slotOf(container);
		expect(slot.className).toBe(
			"group/morph inline-grid items-center justify-items-start data-[gliding]:overflow-x-clip min-w-0 max-w-full",
		);
		expect(slot.hasAttribute("data-gliding")).toBe(false);
		expect(summary(container)).toStrictEqual([{key: "busy|Reading", hidden: null, text: "Reading"}]);
		expect(faces(container)[0]?.className).toBe(FACE_CLASS);
		expect(animations).toStrictEqual([]);
	});

	it("cross-fades to a new key and glides the width", () => {
		const {container, rerender} = render(<Row swapKey="busy|Reading" text="Reading" />);
		rerender(<Row swapKey="done|Read" text="Read" />);
		const slot = slotOf(container);
		expect(summary(container)).toStrictEqual([
			{key: "busy|Reading", hidden: "true", text: "Reading"},
			{key: "done|Read", hidden: null, text: "Read"},
		]);
		expect(faces(container)[1]?.className).toBe(`${FACE_CLASS} ${MORPH_ENTER_CLASS}`);
		expect(faces(container)[0]?.className).toBe(FACE_CLASS);
		expect(
			animations.map((animation) => ({
				target: animation.element.getAttribute("data-morph-key") ?? animation.element.id,
				keyframes: animation.keyframes,
				options: animation.options,
			})),
		).toStrictEqual([
			{
				target: "busy|Reading",
				keyframes: [{opacity: 0, transform: "translateY(-3px)"}],
				options: {duration: 180, easing: "cubic-bezier(0.2,0,0,1)", fill: "both"},
			},
			{
				target: "row-label",
				keyframes: [{width: "80px"}, {width: "40px"}],
				options: {duration: 180, easing: "cubic-bezier(0.2,0,0,1)", fill: "forwards"},
			},
		]);
		expect(slot.getAttribute("data-gliding")).toBe("");
	});

	it("uses fill none when the width grows", () => {
		const {rerender} = render(<Row swapKey="done|Read" text="Read" />);
		rerender(<Row swapKey="busy|Reading" text="Reading" />);
		const glide = animations.find((animation) => animation.element.id === "row-label");
		expect(glide?.keyframes).toStrictEqual([{width: "40px"}, {width: "80px"}]);
		expect(glide?.options.fill).toBe("none");
	});

	it("removes the leaving face and the glide once the leave finishes", async () => {
		const {container, rerender} = render(<Row swapKey="busy|Reading" text="Reading" />);
		rerender(<Row swapKey="done|Read" text="Read" />);
		const [leave, glide] = animations;
		await new Promise((done) => {
			requestAnimationFrame(done);
		});
		await act(async () => {
			leave?.finish();
			await leave?.finished;
		});
		expect(summary(container)).toStrictEqual([{key: "done|Read", hidden: null, text: "Read"}]);
		expect(slotOf(container).hasAttribute("data-gliding")).toBe(false);
		expect(glide?.cancelled).toBe(true);
	});

	it("drops the enter class once the face's animations settle", async () => {
		const {container, rerender} = render(<Row swapKey="busy|Reading" text="Reading" />);
		rerender(<Row swapKey="done|Read" text="Read" />);
		await waitFor(() => {
			expect(container.querySelector('[data-morph-key="done|Read"]')?.className).toBe(FACE_CLASS);
		});
	});

	it("keeps at most two leaving faces and collapses all but the most opaque", () => {
		const {container, rerender} = render(<Row swapKey="busy|Reading" text="Reading" />);
		rerender(<Row swapKey="done|Read" text="Read" />);
		rerender(<Row swapKey="done|Read again" text="Read again" />);
		rerender(<Row swapKey="busy|Writing" text="Writing" />);
		expect(summary(container)).toStrictEqual([
			{key: "done|Read", hidden: "true", text: "Read"},
			{key: "done|Read again", hidden: "true", text: "Read again"},
			{key: "busy|Writing", hidden: null, text: "Writing"},
		]);
		const [first, second] = faces(container);
		expect(first?.style.cssText).toBe("visibility: hidden; width: 0px; height: 0px; overflow: hidden;");
		expect(second?.style.cssText).toBe("");
	});

	it("eases a still-leaving face back when the key swaps back to it", () => {
		const {container, rerender} = render(<Row swapKey="busy|Reading" text="Reading" />);
		rerender(<Row swapKey="done|Read" text="Read" />);
		const leave = animations[0];
		rerender(<Row swapKey="busy|Reading" text="Reading" />);
		expect(leave?.cancelled).toBe(true);
		expect(summary(container)).toStrictEqual([
			{key: "done|Read", hidden: "true", text: "Read"},
			{key: "busy|Reading", hidden: null, text: "Reading"},
		]);
		const back = animations.find(
			(animation) => animation.element.getAttribute("data-morph-key") === "busy|Reading" && animation !== leave,
		);
		expect({keyframes: back?.keyframes, options: back?.options}).toStrictEqual({
			keyframes: [
				{opacity: 1, transform: "translateY(0px)"},
				{opacity: 1, transform: "translateY(0px)"},
			],
			options: {duration: 180, easing: "cubic-bezier(0.2,0,0,1)", fill: "backwards"},
		});
	});

	it("skips the glide when the widths match", () => {
		widths.set("done|Read", 80);
		const {container, rerender} = render(<Row swapKey="busy|Reading" text="Reading" />);
		rerender(<Row swapKey="done|Read" text="Read" />);
		expect(animations.map((animation) => animation.element.id)).toStrictEqual([""]);
		expect(slotOf(container).hasAttribute("data-gliding")).toBe(false);
	});

	it("swaps instantly under the root reduce-motion attribute", () => {
		document.documentElement.setAttribute("data-reduce-motion", "true");
		const {container, rerender} = render(<Row swapKey="busy|Reading" text="Reading" />);
		rerender(<Row swapKey="done|Read" text="Read" />);
		expect(summary(container)).toStrictEqual([{key: "done|Read", hidden: null, text: "Read"}]);
		expect(faces(container)[0]?.className).toBe(FACE_CLASS);
		expect(animations).toStrictEqual([]);
	});

	it("swaps instantly under the OS reduced-motion query", () => {
		vi.stubGlobal(
			"matchMedia",
			(query: string) =>
				({
					matches: query === "(prefers-reduced-motion: reduce)",
					media: query,
					addEventListener: () => {},
					removeEventListener: () => {},
				}) as unknown as MediaQueryList,
		);
		try {
			const {container, rerender} = render(<Row swapKey="busy|Reading" text="Reading" />);
			rerender(<Row swapKey="done|Read" text="Read" />);
			expect(summary(container)).toStrictEqual([{key: "done|Read", hidden: null, text: "Read"}]);
			expect(animations).toStrictEqual([]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("keeps the id across swaps and forwards attrs onto the container", () => {
		const {container, rerender} = render(
			<Row swapKey="busy|Reading" text="Reading" attrs={{"data-cds-phrases-seat": "after-mark"}} />,
		);
		expect(slotOf(container).getAttribute("data-cds-phrases-seat")).toBe("after-mark");
		rerender(<Row swapKey="done|Read" text="Read" attrs={{"data-cds-phrases-seat": ""}} />);
		expect(slotOf(container).getAttribute("data-cds-phrases-seat")).toBe("");
		expect(slotOf(container).className.startsWith(SLOT_CLASS.replace(" min-w-0", ""))).toBe(true);
	});
});
