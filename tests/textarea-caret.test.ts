// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {textareaCaretRect} from "../src/lib/textarea-caret";

interface StubRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

function rect({left, top, width, height}: StubRect): DOMRect {
	return {
		left,
		top,
		width,
		height,
		x: left,
		y: top,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function makeTextarea(value: string): HTMLTextAreaElement {
	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.style.fontSize = "15px";
	textarea.style.lineHeight = "24px";
	textarea.style.paddingLeft = "12px";
	textarea.style.whiteSpace = "pre-wrap";
	document.body.append(textarea);
	return textarea;
}

describe("textareaCaretRect", () => {
	it("returns the mirrored marker span's rect relative to the mirror, minus the textarea scroll", () => {
		const textarea = makeTextarea("hello @sk");
		Object.defineProperty(textarea, "scrollTop", {value: 10, configurable: true});
		Object.defineProperty(textarea, "scrollLeft", {value: 3, configurable: true});

		const seen: {
			mirrorText: string;
			markerText: string;
			afterText: string;
			fontSize: string;
			lineHeight: string;
			paddingLeft: string;
			whiteSpace: string;
			position: string;
			visibility: string;
			overflow: string;
		}[] = [];
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			if (this.dataset["textareaCaretMarker"] !== undefined) {
				const mirror = this.parentElement;
				if (mirror === null) throw new Error("marker detached");
				seen.push({
					mirrorText: mirror.firstChild?.textContent ?? "",
					markerText: this.textContent,
					afterText: this.nextSibling?.textContent ?? "",
					fontSize: mirror.style.fontSize,
					lineHeight: mirror.style.lineHeight,
					paddingLeft: mirror.style.paddingLeft,
					whiteSpace: mirror.style.whiteSpace,
					position: mirror.style.position,
					visibility: mirror.style.visibility,
					overflow: mirror.style.overflow,
				});
				return rect({left: 160, top: 248, width: 9, height: 24});
			}
			if (this.dataset["textareaCaretMirror"] !== undefined) {
				return rect({left: 100, top: 200, width: 400, height: 48});
			}
			return rect({left: 0, top: 0, width: 0, height: 0});
		});

		expect(textareaCaretRect(textarea, 6)).toStrictEqual({left: 57, top: 38, height: 24});
		expect(seen).toStrictEqual([
			{
				mirrorText: "hello ",
				markerText: "@",
				afterText: "sk",
				fontSize: "15px",
				lineHeight: "24px",
				paddingLeft: "12px",
				whiteSpace: "pre-wrap",
				position: "absolute",
				visibility: "hidden",
				overflow: "hidden",
			},
		]);
		expect(document.querySelectorAll("[data-textarea-caret-mirror]").length).toBe(0);
	});

	it("measures a placeholder character when the index is at the end of the value", () => {
		const textarea = makeTextarea("@");
		const markers: string[] = [];
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			if (this.dataset["textareaCaretMarker"] !== undefined) markers.push(this.textContent);
			return rect({left: 0, top: 0, width: 0, height: 0});
		});

		expect(textareaCaretRect(textarea, 1)).toStrictEqual({left: 0, top: 0, height: 0});
		expect(markers).toStrictEqual(["."]);
	});

	it("removes the mirror even when measuring throws", () => {
		const textarea = makeTextarea("abc");
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => {
			throw new Error("boom");
		});

		expect(() => textareaCaretRect(textarea, 1)).toThrow("boom");
		expect(document.querySelectorAll("[data-textarea-caret-mirror]").length).toBe(0);
	});
});
