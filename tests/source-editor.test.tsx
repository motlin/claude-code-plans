// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {SourceEditor} from "../src/components/files/source-editor";

afterEach(() => {
	cleanup();
});

function attributesOf(element: Element, names: string[]): Record<string, string | null> {
	return Object.fromEntries(names.map((name) => [name, element.getAttribute(name)]));
}

describe("SourceEditor read-only", () => {
	it("renders a focusable read-only textbox like upstream's File editor", () => {
		const {container} = render(<SourceEditor value={"a\nb\nc"} readOnly />);
		const content = container.querySelector(".cm-content");
		expect(content).not.toBeNull();
		expect(attributesOf(content!, ["contenteditable", "aria-readonly", "role", "aria-label"])).toStrictEqual({
			contenteditable: "true",
			"aria-readonly": "true",
			role: "textbox",
			"aria-label": "File contents",
		});
	});

	it("draws the line number gutter", () => {
		const {container} = render(<SourceEditor value={"a\nb"} readOnly />);
		expect(container.querySelectorAll(".cm-gutter.cm-lineNumbers").length).toBe(1);
	});

	it("marks the first line active before focus", () => {
		const {container} = render(<SourceEditor value={"a\nb"} readOnly />);
		const lines = [...container.querySelectorAll(".cm-line")];
		expect(lines.map((line) => line.classList.contains("cm-activeLine"))).toStrictEqual([true, false]);
	});

	it("wraps lines by default and drops wrapping when wordWrap is false", () => {
		const {container, rerender} = render(<SourceEditor value="a" readOnly />);
		expect(container.querySelector(".cm-content")!.classList.contains("cm-lineWrapping")).toBe(true);
		rerender(<SourceEditor value="a" readOnly wordWrap={false} />);
		expect(container.querySelector(".cm-content")!.classList.contains("cm-lineWrapping")).toBe(false);
	});

	it("sets tab-size on .cm-content and reconfigures it without remounting", () => {
		const {container, rerender} = render(<SourceEditor value="a" readOnly />);
		const content = container.querySelector(".cm-content") as HTMLElement;
		expect(content.style.getPropertyValue("tab-size")).toBe("4");
		rerender(<SourceEditor value="a" readOnly tabSize={2} />);
		expect(container.querySelector(".cm-content")).toBe(content);
		expect(content.style.getPropertyValue("tab-size")).toBe("2");
	});

	it("replaces the document when value changes", () => {
		const {container, rerender} = render(<SourceEditor value="one" readOnly />);
		rerender(<SourceEditor value={"two\nthree"} readOnly />);
		expect([...container.querySelectorAll(".cm-line")].map((line) => line.textContent)).toStrictEqual([
			"two",
			"three",
		]);
	});
});
