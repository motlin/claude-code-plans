// The jsdom package ships no types; the mermaid sandbox helper only needs a fresh window.
declare module "jsdom" {
	export class JSDOM {
		constructor(html?: string);
		readonly window: Window & typeof globalThis;
	}
}
