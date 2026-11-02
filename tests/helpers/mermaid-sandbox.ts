import {JSDOM} from "jsdom";

/*
 * Stand-ins for what the patched mermaid does inside `render` in sandbox mode, so tests can mock mermaid while the
 * real guard (src/lib/mermaid-guard.ts) meters the frame and checks the parsed diagram.
 */

interface GuardGlobal
{
	parsed: (diagram: unknown, id: string) => void;
}

/** The parsed-diagram hook the guard installs and the patched mermaid calls. */
export function parsedHook(): GuardGlobal["parsed"]
{
	const guard: unknown = Reflect.get(globalThis, "__antMermaidGuard");
	const parsed: unknown = typeof guard === "object" && guard !== null ? Reflect.get(guard, "parsed") : undefined;
	if (typeof parsed !== "function") throw new Error("the mermaid guard has not installed its hook");
	return (diagram, id) =>
	{
		Reflect.apply(parsed, guard, [diagram, id]);
	};
}

/** Mermaid's sandbox iframe: its own window, whose SVG elements answer the measuring calls jsdom lacks. */
export function sandboxFrame(): HTMLIFrameElement
{
	const {window: frameWindow} = new JSDOM("<!doctype html><html><head></head><body></body></html>");
	Object.defineProperty(
		frameWindow.document,
		"readyState",
		{
			configurable: true,
			value: "complete",
		},
	);
	Object.assign(
		frameWindow.SVGElement.prototype,
		{
			getBBox: () => (
			{
				x: 0,
				y: 0,
				width: 10,
				height: 10,
			}),
			getComputedTextLength: () => 10,
		},
	);
	const frame = document.createElement("iframe");
	Object.defineProperty(
		frame,
		"contentDocument",
		{
			configurable: true,
			value: frameWindow.document,
		},
	);
	return frame;
}

/** What mermaid's sandbox mode hands back: an iframe whose base64 `src` holds the drawn SVG. */
export function sandboxed(svg: string): string
{
	return `<iframe style="width:100%" src="data:text/html;charset=UTF-8;base64,${btoa(`<body>${svg}</body>`)}"></iframe>`;
}

export interface ParsedDiagram
{
	type: string;
	text: string;
	db: unknown;
}

const pie = (code: string): ParsedDiagram => (
{
	type: "pie",
	text: code,
	db: {},
});

/** A mocked `mermaid.render` that inserts its frame, hands the parsed diagram to the guard, then draws `svg`. */
export function guardedRender(svg: (id: string) => string, parse: (code: string) => ParsedDiagram = pie)
{
	return async (
		id: string,
		code: string,
		host: HTMLElement,
	): Promise<
	{
		svg: string;
	}> =>
	{
		host.appendChild(sandboxFrame());
		parsedHook()(parse(code), id);
		return Promise.resolve(
			{
				svg: sandboxed(svg(id)),
			},
		);
	};
}
