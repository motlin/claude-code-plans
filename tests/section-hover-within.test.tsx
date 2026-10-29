// @vitest-environment jsdom
import {cleanup, fireEvent, render} from "@testing-library/react";
import {createPortal} from "react-dom";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {sectionHoverWithinProps} from "../src/lib/section-hover-within";

afterEach(() => {
	cleanup();
});

function Sections() {
	return (
		<>
			<div data-testid="a" className="group/section" {...sectionHoverWithinProps}>
				<span data-testid="a-row">row</span>
				{createPortal(<div data-testid="a-menu">menu</div>, document.body)}
			</div>
			<div data-testid="b" className="group/section" {...sectionHoverWithinProps}>
				<span data-testid="b-row">row</span>
			</div>
			<div data-testid="outside">outside</div>
		</>
	);
}

function hoverState(get: (id: string) => HTMLElement) {
	return {a: get("a").hasAttribute("data-hover-within"), b: get("b").hasAttribute("data-hover-within")};
}

describe("sectionHoverWithinProps (upstream G4)", () => {
	it("marks the hovered section, keeps it on a portalled mouseover, and clears the others", () => {
		const {getByTestId} = render(<Sections />);
		expect(hoverState(getByTestId)).toStrictEqual({a: false, b: false});

		fireEvent.mouseOver(getByTestId("a-row"));
		expect(hoverState(getByTestId)).toStrictEqual({a: true, b: false});

		// A row menu portalled out of the section: its mouseover reaches the section through the
		// React tree, which leaves the section marked (enter only adds for DOM descendants).
		fireEvent.mouseOver(getByTestId("a-menu"));
		expect(hoverState(getByTestId)).toStrictEqual({a: true, b: false});

		fireEvent.mouseOver(getByTestId("b-row"));
		expect(hoverState(getByTestId)).toStrictEqual({a: false, b: true});

		fireEvent.mouseOut(getByTestId("b-row"), {relatedTarget: getByTestId("outside")});
		expect(hoverState(getByTestId)).toStrictEqual({a: false, b: false});
	});

	it("keeps the mark while the pointer moves between children of the same section", () => {
		const {getByTestId} = render(<Sections />);
		fireEvent.mouseOver(getByTestId("b-row"));
		fireEvent.mouseOut(getByTestId("b-row"), {relatedTarget: getByTestId("b")});
		expect(hoverState(getByTestId)).toStrictEqual({a: false, b: true});
	});
});
