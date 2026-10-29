// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";

import {flattenOffsets, rangeFromOffsets} from "../src/lib/plan-comment-offsets";

afterEach(() => {
	document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	document.body.append(root);
	return root;
}

function textNode(root: Element, selector: string): Text {
	const node = root.querySelector(selector)?.firstChild;
	if (!(node instanceof Text)) throw new Error(`no text in ${selector}`);
	return node;
}

const HTML = "<p>ab<code>c</code></p><div data-plan-comment-skip><pre>x</pre></div><p id='de'>de</p>";

describe("flattenOffsets", () => {
	it("counts offsets over the root's text, skipping code blocks", () => {
		const root = mount(HTML);
		const range = document.createRange();
		range.setStart(textNode(root, "p"), 1);
		range.setEnd(textNode(root, "#de"), 1);

		expect(flattenOffsets(root, range)).toStrictEqual({start: 1, end: 4, text: "bcd"});
	});

	it("returns null for a selection only inside a skipped block", () => {
		const root = mount(HTML);
		const range = document.createRange();
		range.selectNodeContents(textNode(root, "pre"));

		expect(flattenOffsets(root, range)).toBeNull();
	});

	it("skips a bare pre the renderer did not wrap", () => {
		const root = mount("<p>ab</p><pre>xyz</pre><p id='de'>de</p>");
		const range = document.createRange();
		range.setStart(textNode(root, "p"), 0);
		range.setEnd(textNode(root, "#de"), 2);

		expect(flattenOffsets(root, range)).toStrictEqual({start: 0, end: 4, text: "abde"});
	});

	it("clips a range that runs past the root to the root's end", () => {
		const root = mount("<p>abc</p>");
		const after = document.createElement("p");
		after.textContent = "outside";
		document.body.append(after);
		const range = document.createRange();
		range.setStart(textNode(root, "p"), 1);
		range.setEnd(after.firstChild as Text, 3);

		expect(flattenOffsets(root, range)).toStrictEqual({start: 1, end: 3, text: "bc"});
	});

	it("returns null for a blank selection", () => {
		const root = mount("<p>a  b</p>");
		const range = document.createRange();
		range.setStart(textNode(root, "p"), 1);
		range.setEnd(textNode(root, "p"), 3);

		expect(flattenOffsets(root, range)).toBeNull();
	});
});

describe("rangeFromOffsets", () => {
	it("maps flattened offsets back to a DOM range", () => {
		const root = mount(HTML);
		const range = rangeFromOffsets(root, 1, 4);

		expect(
			range === null
				? null
				: {
						start: [range.startContainer.textContent, range.startOffset],
						end: [range.endContainer.textContent, range.endOffset],
					},
		).toStrictEqual({start: ["ab", 1], end: ["de", 1]});
	});

	it("returns null for offsets past the text", () => {
		const root = mount(HTML);

		expect(rangeFromOffsets(root, 2, 99)).toBeNull();
	});
});
