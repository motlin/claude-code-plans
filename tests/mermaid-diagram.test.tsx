// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {MermaidDiagram} from "../src/components/mermaid-diagram";
import {
	MERMAID_SECURE_KEYS,
	MERMAID_SHADOW_STYLE,
	drawMermaid,
	resetMermaidCachesForTests,
	sanitizeMermaidSvg,
} from "../src/lib/mermaid-render";
import {themeFor} from "../src/lib/mermaid-theme";

const {initialize, renderDiagram} = vi.hoisted(() => ({
	initialize: vi.fn<(config: unknown) => void>(),
	renderDiagram: vi.fn<(id: string, code: string, host: HTMLElement) => Promise<{svg: string}>>(),
}));

vi.mock("mermaid", () => ({default: {initialize, render: renderDiagram}}));

/** What mermaid's sandbox mode hands back: an iframe whose base64 `src` holds the drawn SVG. */
function sandboxed(svg: string): string {
	return `<iframe style="width:100%" src="data:text/html;charset=UTF-8;base64,${btoa(`<body>${svg}</body>`)}"></iframe>`;
}

/** A render that inserts its iframe into the host the way mermaid does, then resolves with `svg`. */
function drawsSvg(svg: (id: string) => string) {
	renderDiagram.mockImplementation(async (id, _code, host) => {
		host.appendChild(document.createElement("iframe"));
		return Promise.resolve({svg: sandboxed(svg(id))});
	});
}

async function settle() {
	for (let i = 0; i < 5; i++) {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	initialize.mockReset();
	renderDiagram.mockReset();
	resetMermaidCachesForTests();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	document.body.removeAttribute("style");
	Reflect.deleteProperty(document, "fonts");
});

const ROOT_CLASS =
	"relative [contain:paint] overflow-x-auto rounded-[var(--msg-block-radius,0.5rem)] border-0.5 border-border bg-surface-3/50 p-4";

describe("MermaidDiagram (upstream shared-41 x2)", () => {
	it("initializes mermaid with upstream's locked-down options and the body font minus web fonts", async () => {
		drawsSvg((id) => `<svg id="${id}"><g class="node"></g></svg>`);
		document.body.style.fontFamily = '"Fabricated Sans", system-ui, sans-serif';
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: {
				forEach: (visit: (face: {family: string}) => void) => {
					visit({family: '"Fabricated Sans"'});
				},
			},
		});
		render(<MermaidDiagram code="graph TD; A-->B" mode="light" />);
		await settle();
		expect(initialize.mock.calls).toStrictEqual([
			[
				{
					startOnLoad: false,
					htmlLabels: false,
					maxTextSize: 20000,
					maxEdges: 400,
					fontFamily: "system-ui, sans-serif",
					theme: "base",
					...themeFor("light"),
					securityLevel: "sandbox",
					secure: MERMAID_SECURE_KEYS,
				},
			],
		]);
		expect(MERMAID_SECURE_KEYS).toStrictEqual(
			"secure securityLevel startOnLoad maxTextSize maxEdges suppressErrorRendering htmlLabels dompurifyConfig themeCSS fontFamily altFontFamily fontSize fontWeight messageFontSize messageFontWeight messageFontFamily noteFontSize noteFontWeight noteFontFamily actorFontSize actorFontWeight actorFontFamily themeVariables theme layout defaultRenderer bitsPerRow numIter look".split(
				" ",
			),
		);
	});

	it("pulses while loading, then draws the SVG into a shadow root under upstream's style", async () => {
		drawsSvg((id) => `<svg id="${id}"><g class="node"></g></svg>`);
		const statuses: string[] = [];
		const {container} = render(
			<MermaidDiagram code="graph TD; A-->B" mode="light" onStatusChange={(status) => statuses.push(status)} />,
		);
		const loading = container.firstElementChild;
		expect({
			tag: loading?.localName,
			className: loading?.className,
			dir: loading?.getAttribute("dir"),
			mermaid: loading?.getAttribute("data-mermaid"),
			role: loading?.getAttribute("role"),
			label: loading?.getAttribute("aria-label"),
		}).toStrictEqual({
			tag: "div",
			className: `${ROOT_CLASS} min-h-24 animate-pulse`,
			dir: "ltr",
			mermaid: "true",
			role: "img",
			label: "Mermaid diagram",
		});

		await settle();
		const root = container.firstElementChild;
		const shadow = root?.shadowRoot;
		expect({
			className: root?.className,
			style: shadow?.firstElementChild?.outerHTML,
			drawn: shadow?.lastElementChild?.localName,
			svg: shadow?.lastElementChild?.firstElementChild?.localName,
			statuses,
		}).toStrictEqual({
			className: ROOT_CLASS,
			style: `<style>${MERMAID_SHADOW_STYLE}</style>`,
			drawn: "div",
			svg: "svg",
			statuses: ["loading", "success"],
		});
		expect(MERMAID_SHADOW_STYLE).toBe(
			":host > div > svg, [data-mermaid] > div > svg { display: block; max-width: 100%; margin-inline: auto; }",
		);
	});

	it("shows the source in upstream's pre when mermaid throws", async () => {
		renderDiagram.mockRejectedValue(new Error("Parse error on line 1"));
		const statuses: string[] = [];
		const {container} = render(
			<MermaidDiagram code="graph TD; A--" mode="dark" onStatusChange={(status) => statuses.push(status)} />,
		);
		await settle();
		const root = container.firstElementChild;
		expect({
			tag: root?.localName,
			className: root?.className,
			dir: root?.getAttribute("dir"),
			mermaid: root?.getAttribute("data-mermaid"),
			text: root?.textContent,
			statuses,
		}).toStrictEqual({
			tag: "pre",
			className:
				"overflow-x-auto whitespace-pre rounded-[var(--msg-block-radius,0.5rem)] border-0.5 border-border bg-surface-3/50 p-3.5 font-mono-ui text-sm",
			dir: "ltr",
			mermaid: "true",
			text: "graph TD; A--",
			statuses: ["loading", "error"],
		});
	});
});

describe("sanitizeMermaidSvg (upstream Vb)", () => {
	it("drops links, images, animation, unscoped style rules and external urls", () => {
		const svg = [
			`<svg id="m1" xmlns="http://www.w3.org/2000/svg">`,
			`<style>body{color:red} #m1 .node{fill:red}</style>`,
			`<a href="https://example.invalid/x"><text>link</text></a>`,
			`<a href="#local"><text>local</text></a>`,
			`<image href="https://example.invalid/i.png"></image>`,
			`<animate attributeName="x"></animate>`,
			`<rect style="fill: url(http://example.invalid/p)" fill="url(#grad)"></rect>`,
			`<text>a\u202Eb</text>`,
			`</svg>`,
		].join("");
		const parsed = document.createElement("div");
		parsed.innerHTML = sanitizeMermaidSvg(svg, "m1");
		expect({
			style: parsed.querySelector("style")?.textContent,
			hrefs: [...parsed.querySelectorAll("a")].map((a) => a.getAttribute("href")),
			image: parsed.querySelector("image"),
			animate: parsed.querySelector("animate"),
			rectStyle: parsed.querySelector("rect")?.getAttribute("style"),
			rectFill: parsed.querySelector("rect")?.getAttribute("fill"),
			bidi: [...parsed.querySelectorAll("text")].at(-1)?.textContent,
		}).toStrictEqual({
			style: "#m1 .node { fill: red; }",
			hrefs: [null, "#local"],
			image: null,
			animate: null,
			rectStyle: "fill: url-blocked(http://example.invalid/p)",
			rectFill: "url(#grad)",
			bidi: "a\uFFFDb",
		});
	});
});

describe("drawMermaid queue (upstream pw/km)", () => {
	it("gives up on a draw after 30 s and refuses later draws until mermaid finishes it", async () => {
		let finish: (value: {svg: string}) => void = () => {};
		renderDiagram.mockImplementationOnce(async (_id, _code, host) => {
			host.appendChild(document.createElement("iframe"));
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const mermaid = {initialize, render: renderDiagram} as unknown as Parameters<typeof drawMermaid>[0];
		const first = drawMermaid(mermaid, {theme: "base"}, "m1", "graph TD", {limitMs: 30_000});
		const firstError = first.catch((error: unknown) => (error as Error).name);
		await vi.advanceTimersByTimeAsync(29_999);
		const second = drawMermaid(mermaid, {theme: "base"}, "m2", "graph TD", {limitMs: 30_000});
		const secondError = second.catch((error: unknown) => (error as Error).name);
		await vi.advanceTimersByTimeAsync(1);
		expect(await firstError).toBe("MermaidRenderTimeout");
		expect(await secondError).toBe("MermaidQueueStalled");

		finish({svg: sandboxed("<svg></svg>")});
		await vi.advanceTimersByTimeAsync(0);
		drawsSvg((id) => `<svg id="${id}"></svg>`);
		const third = drawMermaid(mermaid, {theme: "base"}, "m3", "graph TD", {limitMs: 30_000});
		await vi.advanceTimersByTimeAsync(0);
		expect(await third).toStrictEqual({svg: '<svg id="m3"></svg>', diagramId: "m3"});
	});
});
