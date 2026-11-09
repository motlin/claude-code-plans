// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {AttachedContextChips} from "../src/components/attached-context-chips";
import {ToastProvider} from "../src/components/toast";
import {
	attachContext,
	type ContextChip,
	getContextChips,
	hydrateStagedChips,
	removeContextChip,
	registerComposer,
	takeContextChips,
	useContextChips,
} from "../src/lib/context-attach";

const SESSION = "session-alice";

const IMAGE: ContextChip = {
	id: "chip-1",
	kind: "image",
	path: "/cache/attachments/1.png",
	name: "shot.png",
	previewUrl: "blob:shot",
};

const FILE: ContextChip = {
	id: "chip-2",
	kind: "file",
	path: "/cache/attachments/2.md",
	name: "notes.md",
};

function classes(element: Element | null): string[] {
	return (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).toSorted();
}

function renderChips(context: readonly ContextChip[]) {
	return render(<AttachedContextChips sessionId={SESSION} context={context} comments={[]} />);
}

afterEach(cleanup);

describe("AttachedContextChips cds tiles", () => {
	it("lays the tiles out in upstream's composer attachments tray", () => {
		const {container} = renderChips([IMAGE]);
		const tray = container.querySelector("[data-cds-composer-attachments]");
		expect({
			clip: classes(container.querySelector("[data-cds-composer-attachments-clip]")),
			tray: classes(tray),
			list: classes(tray?.querySelector('ul[aria-label="Attached context"]') ?? null),
		}).toStrictEqual({
			clip: ["-mt-2", "-mx-2", "grid", "grid-rows-[1fr]", "overflow-hidden", "pt-2", "px-2"],
			tray: ["min-h-0", "min-w-0", "pb-2.5", "pt-1", "px-1"],
			list: [
				"*:shrink-0",
				"-m-2",
				"-me-2.5",
				"-mt-2.5",
				"flex",
				"gap-[6px]",
				"items-end",
				"overflow-x-auto",
				"overscroll-x-contain",
				"p-2",
				"pe-2.5",
				"pt-2.5",
				"scroll-fade-x",
			],
		});
	});

	it("marks the tray list as upstream's composer MessageAttachments row", () => {
		const {container} = renderChips([IMAGE]);
		const list = container.querySelector('ul[aria-label="Attached context"]');
		expect({
			cds: list?.getAttribute("data-cds"),
			row: list?.getAttribute("data-cds-composer-attachments-row"),
		}).toStrictEqual({cds: "MessageAttachments", row: ""});
	});

	it("renders an image chip as a 120px cds tile with a zoom CardLink and a hover-revealed remove button", () => {
		const {container} = renderChips([IMAGE]);
		const tile = container.querySelector("li[data-cds=MessageAttachmentsImage]");
		const card = tile?.querySelector("[data-cds=Card]") ?? null;
		const link = tile?.querySelector("[data-cds=CardLink]") ?? null;
		const img = link?.querySelector("img") ?? null;
		const remove = tile?.querySelector("button[data-cds-attachment-remove]") ?? null;
		expect({
			attachment: tile?.getAttribute("data-cds-attachment"),
			tabIndex: tile?.getAttribute("tabindex"),
			tile: classes(tile ?? null),
			card: classes(card),
			fill: classes(card?.querySelector(".cds-card-fill") ?? null),
			link: {
				role: link?.getAttribute("role"),
				tabIndex: link?.getAttribute("tabindex"),
				classes: classes(link),
			},
			img: {
				alt: img?.getAttribute("alt"),
				src: img?.getAttribute("src"),
				loading: img?.getAttribute("loading"),
				decoding: img?.getAttribute("decoding"),
				width: img?.getAttribute("width"),
				height: img?.getAttribute("height"),
				classes: classes(img),
			},
			name: link?.querySelector("span.sr-only")?.textContent,
			remove: {label: remove?.getAttribute("aria-label"), classes: classes(remove)},
			glyph: tile?.querySelector("[data-attachment-glyph]") ?? null,
		}).toStrictEqual({
			attachment: "",
			tabIndex: "-1",
			tile: [
				"focus-visible:shadow-focus",
				"group/tile",
				"isolate",
				"outline-none",
				"relative",
				"rounded-r7",
				"shrink-0",
				"size-[7.5rem]",
			],
			card: [
				"[--card-ring-color:var(--upstream-border-strong)]",
				"after:absolute",
				"after:content-['']",
				"after:inset-0",
				"after:pointer-events-none",
				"after:rounded-[inherit]",
				"after:shadow-card-ring",
				"flex",
				"flex-col",
				"group/card",
				"has-[[data-cds=CardLink]:focus-visible]:after:shadow-focus",
				"isolate",
				"relative",
				"rounded-card-xs",
				"size-full",
			],
			fill: [
				"-z-[1]",
				"absolute",
				"bg-surface-3",
				"cds-card-fill",
				"inset-0",
				"m-0",
				"pointer-events-none",
				"rounded-[inherit]",
				"shadow-field-drop",
			],
			link: {
				role: "button",
				tabIndex: "0",
				classes: [
					"after:absolute",
					"after:content-['']",
					"after:inset-0",
					"after:pointer-events-none",
					"after:rounded-card-xs",
					"cursor-zoom-in",
					"outline-none",
				],
			},
			img: {
				alt: "",
				src: "blob:shot",
				loading: "lazy",
				decoding: "async",
				width: "120",
				height: "120",
				classes: [
					"absolute",
					"block",
					"duration-200",
					"inset-0",
					"motion-reduce:transition-none",
					"object-contain",
					"opacity-100",
					"rounded-card-xs",
					"size-full",
					"transition-opacity",
				],
			},
			name: "shot.png",
			remove: {
				label: "Remove shot.png",
				classes: [
					"-end-2",
					"-top-2",
					"absolute",
					"before:-inset-0.5",
					"before:absolute",
					"before:content-['']",
					"bg-surface-3",
					"cursor-pointer",
					"focus-visible:shadow-focus",
					"group-focus-visible/tile:opacity-100",
					"group-has-[:focus-visible]/tile:opacity-100",
					"group-hover/tile:opacity-100",
					"hover:text-primary",
					"inline-flex",
					"items-center",
					"justify-center",
					"opacity-0",
					"outline-none",
					"rounded-full",
					"shadow-card-ring",
					"size-5",
					"text-secondary",
					"touch:opacity-100",
					"z-[1]",
				],
			},
			glyph: null,
		});
	});

	it("hides an undecodable image and shows a centred Image glyph instead", () => {
		const {container} = renderChips([IMAGE]);
		const img = container.querySelector("li[data-cds=MessageAttachmentsImage] img");
		if (img === null) throw new Error("no img");
		fireEvent.error(img);
		const glyph = container.querySelector("[data-attachment-glyph]");
		expect({
			imgOpacity: classes(img).filter((name) => name.startsWith("opacity-")),
			glyph: classes(glyph),
			icon: glyph?.querySelector("svg") !== null,
		}).toStrictEqual({
			imgOpacity: ["opacity-0"],
			glyph: [
				"absolute",
				"flex",
				"inset-0",
				"items-center",
				"justify-center",
				"pointer-events-none",
				"text-ink-muted",
			],
			icon: true,
		});
	});

	it("renders an uploaded file chip as a cds tile with its name and an extension badge", () => {
		const {container} = renderChips([FILE]);
		const tile = container.querySelector("li[data-cds=MessageAttachmentsFile]");
		const name = tile?.querySelector("span[aria-hidden][title]") ?? null;
		const badge = tile?.querySelector("[data-cds=Badge]") ?? null;
		expect({
			tile: classes(tile ?? null),
			srName: tile?.querySelector("[data-cds-card-body] span.sr-only")?.textContent,
			name: {
				title: name?.getAttribute("title"),
				classes: classes(name),
				bdi: name?.querySelector("bdi")?.textContent,
			},
			badge: badge?.textContent,
			remove: tile?.querySelector("button[data-cds-attachment-remove]")?.getAttribute("aria-label"),
		}).toStrictEqual({
			tile: [
				"focus-visible:shadow-focus",
				"group/tile",
				"isolate",
				"outline-none",
				"relative",
				"rounded-r7",
				"shrink-0",
				"size-[7.5rem]",
			],
			srName: "notes.md",
			name: {
				title: "notes.md",
				classes: [
					"[overflow-wrap:anywhere]",
					"break-words",
					"font-normal",
					"line-clamp-4",
					"text-footnote",
					"text-primary",
				],
				bdi: "notes.md",
			},
			badge: "MD",
			remove: "Remove notes.md",
		});
	});

	it("renders an excerpt chip as upstream's 120px quote tile with a rail, the clamped text and an Excerpt badge", () => {
		const {container} = renderChips([{id: "chip-e", kind: "excerpt", text: "Even so, they’re ful"}]);
		const tile = container.querySelector("li[data-cds=MessageAttachmentsQuote]");
		const link = tile?.querySelector("[data-cds=CardLink]") ?? null;
		const quote = tile?.querySelector("blockquote") ?? null;
		const remove = tile?.querySelector("button[data-cds-attachment-remove]") ?? null;
		expect({
			attachment: tile?.getAttribute("data-cds-attachment"),
			tile: classes(tile ?? null),
			link: {role: link?.getAttribute("role"), tabIndex: link?.getAttribute("tabindex"), classes: classes(link)},
			srName: link?.querySelector("span.sr-only")?.textContent,
			row: classes(quote?.parentElement ?? null),
			rail: classes(quote?.previousElementSibling ?? null),
			quote: {dir: quote?.getAttribute("dir"), classes: classes(quote), text: quote?.textContent},
			badge: {
				classes: classes(tile?.querySelector("[data-cds=Badge]") ?? null),
				text: tile?.querySelector("[data-cds=Badge]")?.textContent,
			},
			remove: {label: remove?.getAttribute("aria-label"), classes: classes(remove)},
		}).toStrictEqual({
			attachment: "",
			tile: [
				"focus-visible:shadow-focus",
				"group/tile",
				"isolate",
				"outline-none",
				"relative",
				"rounded-r7",
				"shrink-0",
				"size-[7.5rem]",
			],
			link: {
				role: "button",
				tabIndex: "0",
				classes: [
					"after:absolute",
					"after:content-['']",
					"after:inset-0",
					"after:rounded-card-xs",
					"cursor-pointer",
					"outline-none",
				],
			},
			srName: "Even so, they’re ful",
			row: ["flex", "gap-xs", "min-h-0", "min-w-0"],
			rail: ["bg-border", "rounded-full", "self-stretch", "shrink-0", "w-[3px]"],
			quote: {
				dir: "auto",
				classes: [
					"[overflow-wrap:anywhere]",
					"break-words",
					"flex-1",
					"font-normal",
					"leading-tight",
					"line-clamp-5",
					"min-w-0",
					"text-caption",
					"text-secondary",
				],
				text: "Even so, they’re ful",
			},
			badge: {
				classes: [
					"align-middle",
					"bg-fill-ghost-hover",
					"font-medium",
					"font-sans",
					"gap-1",
					"h-5",
					"inline-flex",
					"items-center",
					"max-w-full",
					"min-w-0",
					"px-2",
					"rounded-full",
					"self-start",
					"shrink-0",
					"text-caption",
					"text-secondary",
					"whitespace-nowrap",
				],
				text: "Excerpt",
			},
			remove: {
				label: "Remove Even so, they’re ful",
				classes: [
					"-end-2",
					"-top-2",
					"absolute",
					"before:-inset-0.5",
					"before:absolute",
					"before:content-['']",
					"bg-surface-3",
					"cursor-pointer",
					"focus-visible:shadow-focus",
					"group-focus-visible/tile:opacity-100",
					"group-has-[:focus-visible]/tile:opacity-100",
					"group-hover/tile:opacity-100",
					"hover:text-primary",
					"inline-flex",
					"items-center",
					"justify-center",
					"opacity-0",
					"outline-none",
					"rounded-full",
					"shadow-card-ring",
					"size-5",
					"text-secondary",
					"touch:opacity-100",
					"z-[1]",
				],
			},
		});
	});

	it("removes an excerpt tile from its corner button", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		attachContext(SESSION, {kind: "excerpt", text: "Hermit crabs"});
		function Live() {
			return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
		}
		const {container} = render(<Live />);
		fireEvent.click(screen.getByRole("button", {name: "Remove Hermit crabs"}));
		const left = container.querySelector("li[data-cds=MessageAttachmentsQuote]");
		cleanup();
		takeContextChips(SESSION);
		stop();
		expect(left).toBeNull();
	});

	describe("removal focus hand-off", () => {
		const tiles: readonly ContextChip[] = [1, 2, 3].map((n) => ({
			id: `chip-${n}`,
			kind: "image",
			path: `/cache/attachments/${n}.png`,
			name: `shot-${n}.png`,
			previewUrl: `blob:shot-${n}`,
		}));

		function cardLink(container: HTMLElement, name: string): Element | null {
			return container.querySelector(`li[data-chip-label="${name}"] [data-cds=CardLink]`);
		}

		function removeWithKeyboard(container: HTMLElement, name: string): void {
			const remove = container.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name}"]`);
			if (remove === null) throw new Error(`no remove button for ${name}`);
			remove.focus();
			fireEvent.click(remove);
		}

		it("focuses the next tile's CardLink when a focused tile is removed", () => {
			const {container, rerender} = renderChips(tiles);
			removeWithKeyboard(container, "shot-2.png");
			rerender(<AttachedContextChips sessionId={SESSION} context={[tiles[0]!, tiles[2]!]} comments={[]} />);
			expect(document.activeElement).toBe(cardLink(container, "shot-3.png"));
		});

		it("focuses the previous tile's CardLink when the focused last tile is removed", () => {
			const {container, rerender} = renderChips(tiles);
			removeWithKeyboard(container, "shot-3.png");
			rerender(<AttachedContextChips sessionId={SESSION} context={[tiles[0]!, tiles[1]!]} comments={[]} />);
			expect(document.activeElement).toBe(cardLink(container, "shot-2.png"));
		});

		it("keeps focus where it was on a pointer removal", () => {
			const editor = document.createElement("textarea");
			document.body.append(editor);
			editor.focus();
			const {container} = renderChips(tiles);
			const remove = container.querySelector('button[aria-label="Remove shot-2.png"]');
			if (remove === null) throw new Error("no remove button");
			const defaultAllowed = fireEvent.mouseDown(remove);
			fireEvent.click(remove);
			expect({defaultAllowed, active: document.activeElement === editor}).toStrictEqual({
				defaultAllowed: false,
				active: true,
			});
			editor.remove();
		});
	});

	describe("Delete/Backspace on a focused tile", () => {
		const SHOTS = ["shot-1.png", "shot-2.png", "shot-3.png"];
		let stop: () => void = () => {};

		function LiveChips() {
			return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
		}

		beforeEach(() => {
			stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
			for (const name of SHOTS) {
				attachContext(SESSION, {
					kind: "image",
					path: `/cache/attachments/${name}`,
					name,
					previewUrl: `blob:${name}`,
				});
			}
		});

		afterEach(() => {
			cleanup();
			takeContextChips(SESSION);
			stop();
		});

		function link(container: HTMLElement, name: string): HTMLElement {
			const found = container.querySelector<HTMLElement>(`li[data-chip-label="${name}"] [data-cds=CardLink]`);
			if (found === null) throw new Error(`no CardLink for ${name}`);
			return found;
		}

		function tileNames(container: HTMLElement): (string | null)[] {
			return Array.from(container.querySelectorAll("li"), (li) => li.getAttribute("data-chip-label"));
		}

		it("removes the tile on Delete and focuses the next tile's CardLink", () => {
			const {container} = render(<LiveChips />);
			link(container, "shot-2.png").focus();
			let defaultAllowed = true;
			act(() => {
				defaultAllowed = fireEvent.keyDown(link(container, "shot-2.png"), {key: "Delete"});
			});
			expect({
				defaultAllowed,
				tiles: tileNames(container),
				focused: document.activeElement === link(container, "shot-3.png"),
			}).toStrictEqual({defaultAllowed: false, tiles: ["shot-1.png", "shot-3.png"], focused: true});
		});

		it("removes the last tile on Backspace and focuses the previous tile's CardLink", () => {
			const {container} = render(<LiveChips />);
			link(container, "shot-3.png").focus();
			act(() => {
				fireEvent.keyDown(link(container, "shot-3.png"), {key: "Backspace"});
			});
			expect({
				tiles: tileNames(container),
				focused: document.activeElement === link(container, "shot-2.png"),
			}).toStrictEqual({tiles: ["shot-1.png", "shot-2.png"], focused: true});
		});

		it.each([
			{name: "⌘", init: {metaKey: true}},
			{name: "Ctrl", init: {ctrlKey: true}},
			{name: "Alt", init: {altKey: true}},
			{name: "Shift", init: {shiftKey: true}},
			{name: "a repeat", init: {repeat: true}},
			{name: "an IME composition", init: {isComposing: true}},
		])("removes nothing with $name", ({init}) => {
			const {container} = render(<LiveChips />);
			const target = link(container, "shot-2.png");
			target.focus();
			act(() => {
				fireEvent.keyDown(target, {key: "Delete", ...init});
				fireEvent.keyDown(target, {key: "Backspace", ...init});
			});
			expect({tiles: tileNames(container), focused: document.activeElement === target}).toStrictEqual({
				tiles: SHOTS,
				focused: true,
			});
		});
	});

	describe("image preview", () => {
		beforeEach(() => {
			vi.stubGlobal("matchMedia", (query: string) => ({
				matches: false,
				media: query,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			}));
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		function imageLink(container: HTMLElement): HTMLElement {
			const link = container.querySelector<HTMLElement>(
				"li[data-cds=MessageAttachmentsImage] [data-cds=CardLink]",
			);
			if (link === null) throw new Error("no image CardLink");
			return link;
		}

		async function previewOf(): Promise<{src: string | null; alt: string | null}> {
			const dialog = await screen.findByRole("dialog");
			const img = dialog.querySelector("img");
			return {src: img?.getAttribute("src") ?? null, alt: img?.getAttribute("alt") ?? null};
		}

		it("opens the preview of a ready image on click, hiding the tile's image", async () => {
			const {container} = renderChips([IMAGE]);
			const link = imageLink(container);
			link.focus();
			fireEvent.click(link);
			expect({
				preview: await previewOf(),
				tileVisibility: link.querySelector("img")?.style.visibility,
			}).toStrictEqual({preview: {src: "blob:shot", alt: "shot.png"}, tileVisibility: "hidden"});
		});

		it.each(["Enter", " "])("opens the preview on %j", async (key) => {
			const {container} = renderChips([IMAGE]);
			const link = imageLink(container);
			link.focus();
			const defaultAllowed = fireEvent.keyDown(link, {key});
			expect({defaultAllowed, preview: await previewOf()}).toStrictEqual({
				defaultAllowed: false,
				preview: {src: "blob:shot", alt: "shot.png"},
			});
		});

		it("closes on Escape, refocusing the tile's CardLink and showing its image again", async () => {
			const {container} = renderChips([IMAGE]);
			const link = imageLink(container);
			link.focus();
			fireEvent.click(link);
			const dialog = await screen.findByRole("dialog");
			act(() => {
				fireEvent.keyDown(dialog, {key: "Escape"});
			});
			expect({
				dialog: screen.queryByRole("dialog"),
				focused: document.activeElement === link,
				tileVisibility: link.querySelector("img")?.style.visibility,
			}).toStrictEqual({dialog: null, focused: true, tileVisibility: ""});
		});

		it("names a pending image by its alt, with upstream's lazy 120x120 img attributes", () => {
			const {container} = renderChips([{...IMAGE, status: "pending"}]);
			const img = container.querySelector("li[data-cds=MessageAttachmentsImage] img");
			expect({
				alt: img?.getAttribute("alt"),
				loading: img?.getAttribute("loading"),
				decoding: img?.getAttribute("decoding"),
				width: img?.getAttribute("width"),
				height: img?.getAttribute("height"),
				link: container.querySelector("[data-cds=CardLink]"),
			}).toStrictEqual({
				alt: "shot.png",
				loading: "lazy",
				decoding: "async",
				width: "120",
				height: "120",
				link: null,
			});
		});

		it("gives a pending image no CardLink to open", () => {
			const {container} = renderChips([{...IMAGE, status: "pending"}]);
			const tile = container.querySelector<HTMLElement>("li[data-cds=MessageAttachmentsImage]");
			if (tile === null) throw new Error("no tile");
			fireEvent.click(tile.querySelector("img") ?? tile);
			expect({
				link: tile.querySelector("[data-cds=CardLink]"),
				dialog: screen.queryByRole("dialog"),
			}).toStrictEqual({link: null, dialog: null});
		});

		it("removes the open preview when the strip unmounts", async () => {
			const {container, unmount} = renderChips([IMAGE]);
			fireEvent.click(imageLink(container));
			await screen.findByRole("dialog");
			unmount();
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});
});

describe("AttachedContextChips text preview", () => {
	const MESSAGE: ContextChip = {id: "chip-m", kind: "message", text: "hello\nworld"};
	const SELECTION: ContextChip = {
		id: "chip-s",
		kind: "selection",
		path: "/w/src/a.ts",
		range: {start: 1, end: 3},
		text: "one\ntwo\nthree",
		language: "ts",
	};
	const TERMINAL: ContextChip = {id: "chip-t", kind: "terminal", text: "$ ls\nREADME.md"};

	function linkOf(container: HTMLElement, label: string): HTMLElement {
		const link = container.querySelector<HTMLElement>(`li[data-chip-label="${label}"] [data-cds=CardLink]`);
		if (link === null) throw new Error(`no CardLink for ${label}`);
		return link;
	}

	async function openedPreview() {
		const dialog = await screen.findByRole("dialog");
		return {
			title: dialog.querySelector("h2")?.textContent,
			variant: dialog.querySelector("blockquote") === null ? "file" : "excerpt",
			text: (dialog.querySelector("blockquote") ?? dialog.querySelector("div[dir=auto]"))?.textContent,
		};
	}

	it("gives message, selection and terminal pills a keyboard-focusable CardLink with the default cursor", () => {
		const {container} = renderChips([MESSAGE, SELECTION, TERMINAL]);
		const links = ["Message", "a.ts:1-3", "Terminal output"].map((label) => {
			const link = linkOf(container, label);
			return {role: link.getAttribute("role"), tabIndex: link.getAttribute("tabindex"), classes: classes(link)};
		});
		const expected = {
			role: "button",
			tabIndex: "0",
			classes: [
				"flex",
				"items-center",
				"gap-1",
				"min-w-0",
				"outline-none",
				"rounded-r5",
				"focus-visible:shadow-focus",
			].toSorted(),
		};
		expect(links).toStrictEqual([expected, expected, expected]);
	});

	it("opens a message as an Excerpt", async () => {
		const {container} = renderChips([MESSAGE]);
		fireEvent.click(linkOf(container, "Message"));
		expect(await openedPreview()).toStrictEqual({title: "Excerpt", variant: "excerpt", text: "hello\nworld"});
	});

	it("opens an excerpt tile as an Excerpt", async () => {
		const {container} = renderChips([{id: "chip-e", kind: "excerpt", text: "Hermit crabs"}]);
		const link = container.querySelector<HTMLElement>("li[data-cds=MessageAttachmentsQuote] [data-cds=CardLink]");
		if (link === null) throw new Error("no excerpt CardLink");
		fireEvent.click(link);
		expect(await openedPreview()).toStrictEqual({title: "Excerpt", variant: "excerpt", text: "Hermit crabs"});
	});

	it("opens a selection as a file titled by its label", async () => {
		const {container} = renderChips([SELECTION]);
		fireEvent.click(linkOf(container, "a.ts:1-3"));
		expect(await openedPreview()).toStrictEqual({title: "a.ts:1-3", variant: "file", text: "one\ntwo\nthree"});
	});

	it.each(["Enter", " "])("opens terminal output on %j", async (key) => {
		const {container} = renderChips([TERMINAL]);
		const defaultAllowed = fireEvent.keyDown(linkOf(container, "Terminal output"), {key});
		expect({defaultAllowed, preview: await openedPreview()}).toStrictEqual({
			defaultAllowed: false,
			preview: {title: "Terminal output", variant: "file", text: "$ ls\nREADME.md"},
		});
	});

	it("opens a pasted-text pill as a file titled Pasted text", async () => {
		const {container} = renderChips([{id: "chip-x", kind: "pasted-text", text: "alpha\nbeta"}]);
		fireEvent.click(linkOf(container, "Pasted text · 2 lines"));
		expect(await openedPreview()).toStrictEqual({title: "Pasted text", variant: "file", text: "alpha\nbeta"});
	});

	it("closes on Escape, refocusing the pill's CardLink", async () => {
		const {container} = renderChips([MESSAGE]);
		const link = linkOf(container, "Message");
		link.focus();
		fireEvent.click(link);
		const dialog = await screen.findByRole("dialog");
		act(() => {
			fireEvent.keyDown(dialog, {key: "Escape"});
		});
		await vi.waitFor(() => {
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(document.activeElement === link).toBe(true);
	});

	it("gives a path chip with no text nothing to open", () => {
		const {container} = renderChips([{id: "chip-p", kind: "file", path: "/w/src/a.ts"}]);
		expect(container.querySelector("[data-cds=CardLink]")).toBeNull();
	});
});

describe("AttachedContextChips path chip file actions", () => {
	function renderWithCwd(context: readonly ContextChip[]) {
		return render(
			<ToastProvider>
				<AttachedContextChips sessionId={SESSION} context={context} comments={[]} cwd="/w" />
			</ToastProvider>,
		);
	}

	function chipOf(container: HTMLElement, label: string): HTMLElement {
		const chip = container.querySelector<HTMLElement>(`li[data-chip-label="${label}"]`);
		if (chip === null) throw new Error(`no chip ${label}`);
		return chip;
	}

	/** The newest open menu's rows, top to bottom: item labels, with "─" for separators. */
	function menuRows(): string[] {
		const menu = screen.getAllByRole("menu").at(-1);
		if (menu === undefined) throw new Error("no menu open");
		return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
		);
	}

	async function openSubmenu(label: string): Promise<string[]> {
		const trigger = screen
			.getAllByRole("menuitem")
			.find((row) => (row.firstElementChild?.textContent ?? row.textContent) === label);
		if (trigger === undefined) throw new Error(`no item ${label}`);
		fireEvent.click(trigger);
		return vi.waitFor(() => {
			const rows = menuRows();
			if (rows.includes(label)) throw new Error(`${label} ▸ not open`);
			return rows;
		});
	}

	it("a file chip's right-click lists Copy ▸ · ─ · Open in ▸ · Show in Finder, without Attach as context", async () => {
		const {container} = renderWithCwd([{id: "chip-p", kind: "file", path: "src/a.ts"}]);
		const notPrevented = fireEvent.contextMenu(chipOf(container, "a.ts"), {clientX: 10, clientY: 10});
		const rows = await vi.waitFor(() => menuRows());
		const copyRows = await openSubmenu("Copy");

		expect({notPrevented, rows, copyRows}).toStrictEqual({
			notPrevented: false,
			rows: ["Copy", "─", "Open in", "Show in Finder"],
			copyRows: ["Absolute path", "Relative path", "Filename"],
		});
	});

	it("a folder chip has no Default app row", async () => {
		const {container} = renderWithCwd([{id: "chip-d", kind: "file", path: "docs/"}]);
		fireEvent.contextMenu(chipOf(container, "docs/"), {clientX: 10, clientY: 10});
		await vi.waitFor(() => menuRows());

		expect(await openSubmenu("Open in")).toStrictEqual(["VS Code"]);
	});

	it("a plain click on a path chip opens nothing", () => {
		const {container} = renderWithCwd([{id: "chip-p", kind: "file", path: "src/a.ts"}]);
		fireEvent.click(chipOf(container, "a.ts"));

		expect(screen.queryAllByRole("menu")).toStrictEqual([]);
	});

	it("image and uploaded-file chips get no menu: their right-click isn't default-prevented", () => {
		const {container} = renderWithCwd([IMAGE, FILE]);
		const results = [IMAGE, FILE].map((chip) =>
			fireEvent.contextMenu(chipOf(container, chip.name ?? ""), {clientX: 10, clientY: 10}),
		);

		expect({results, menus: screen.queryAllByRole("menu")}).toStrictEqual({results: [true, true], menus: []});
	});
});

/** Lays each tile out 126px apart from x=0 in a 300px-wide row, shifted by the row's scrollLeft. */
function stubRowGeometry(container: HTMLElement) {
	const row = container.querySelector<HTMLElement>('ul[aria-label="Attached context"]');
	if (row === null) throw new Error("no row");
	const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
	Object.assign(row, {scrollTo});
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement) {
		if (this === row) return DOMRect.fromRect({x: 0, y: 0, width: 300, height: 136});
		const tiles = [...row.children];
		const index = tiles.indexOf(this);
		return DOMRect.fromRect({x: index * 126 - row.scrollLeft, y: 8, width: 120, height: 120});
	});
	return {row, scrollTo};
}

function shot(n: number): ContextChip {
	return {
		id: `chip-${n}`,
		kind: "image",
		path: `/cache/attachments/${n}.png`,
		name: `shot-${n}.png`,
		previewUrl: `blob:shot-${n}`,
	};
}

describe("AttachedContextChips scrolling row", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("scrolls a tile added after mount into the row's view, but not tiles present at mount", () => {
		const {container, rerender} = renderChips([shot(1), shot(2)]);
		const {scrollTo} = stubRowGeometry(container);
		rerender(<AttachedContextChips sessionId={SESSION} context={[shot(1), shot(2)]} comments={[]} />);
		const atMount = scrollTo.mock.calls.length;
		rerender(<AttachedContextChips sessionId={SESSION} context={[shot(1), shot(2), shot(3)]} comments={[]} />);
		// Tile 3 spans 252-372 in a 300px row: scroll right by 72px.
		expect({atMount, calls: scrollTo.mock.calls}).toStrictEqual({
			atMount: 0,
			calls: [[{left: 72, behavior: "instant"}]],
		});
	});

	it("leaves the row alone when a new tile is already in view", () => {
		const {container, rerender} = renderChips([shot(1)]);
		const {scrollTo} = stubRowGeometry(container);
		rerender(<AttachedContextChips sessionId={SESSION} context={[shot(1), shot(2)]} comments={[]} />);
		expect(scrollTo.mock.calls).toStrictEqual([]);
	});

	it("scrolls a keyboard-focused tile into view on focusin, not a pointer-focused one", () => {
		const {container} = renderChips([shot(1), shot(2), shot(3)]);
		const {scrollTo} = stubRowGeometry(container);
		const link = container.querySelector<HTMLElement>('li[data-chip-label="shot-3.png"] [data-cds=CardLink]');
		if (link === null) throw new Error("no CardLink");
		const matches = vi.spyOn(link, "matches").mockReturnValue(false);
		fireEvent.focusIn(link);
		const pointer = scrollTo.mock.calls.length;
		matches.mockImplementation((selector: string) => selector === ":focus-visible");
		fireEvent.focusIn(link);
		expect({pointer, calls: scrollTo.mock.calls}).toStrictEqual({
			pointer: 0,
			calls: [[{left: 72, behavior: "instant"}]],
		});
	});

	it("focuses the next tile without scrolling on keyboard removal, then scrolls it into view once the old tile is gone", async () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		for (const n of [1, 2, 3]) {
			attachContext(SESSION, {
				kind: "image",
				path: `/cache/attachments/${n}.png`,
				name: `shot-${n}.png`,
				previewUrl: `blob:${n}`,
			});
		}
		function Live() {
			return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
		}
		const {container} = render(<Live />);
		const {row, scrollTo} = stubRowGeometry(container);
		row.scrollLeft = 0;
		// jsdom's selector engine decides :focus-visible from the window's last key or pointer event and last
		// focus-visible node, which earlier tests leave behind, so pin it: this test covers the hand-off's own
		// scroll; the focusin scroll of a keyboard-focused tile is the test above.
		const matches = HTMLElement.prototype.matches;
		vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, selector: string) {
			return selector === ":focus-visible" ? false : matches.call(this, selector);
		});
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		const link = (name: string) =>
			container.querySelector<HTMLElement>(`li[data-chip-label="${name}"] [data-cds=CardLink]`)!;
		link("shot-2.png").focus();
		focus.mockClear();
		act(() => {
			fireEvent.keyDown(link("shot-2.png"), {key: "Delete"});
		});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});
		const result = {
			focusedNext: document.activeElement === link("shot-3.png"),
			focusArgs: focus.mock.calls,
			// Tile 3 now sits second, at 126-246: inside the 300px row, so no scroll is needed.
			scrolls: scrollTo.mock.calls,
		};
		cleanup();
		takeContextChips(SESSION);
		stop();
		expect(result).toStrictEqual({focusedNext: true, focusArgs: [[{preventScroll: true}]], scrolls: []});
	});
});

describe("AttachedContextChips last-tile keyboard removal", () => {
	let stop: () => void = () => {};
	let editor: HTMLTextAreaElement;

	function LiveChips() {
		return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
	}

	beforeEach(() => {
		editor = document.createElement("textarea");
		document.body.append(editor);
		stop = registerComposer(SESSION, {
			insertText: () => {},
			focus: () => {
				editor.focus();
			},
		});
		attachContext(SESSION, {
			kind: "image",
			path: "/cache/attachments/solo.png",
			name: "solo.png",
			previewUrl: "blob:solo",
		});
		editor.blur();
	});

	afterEach(() => {
		cleanup();
		takeContextChips(SESSION);
		stop();
		editor.remove();
	});

	function soloLink(container: HTMLElement): HTMLElement {
		const found = container.querySelector<HTMLElement>('li[data-chip-label="solo.png"] [data-cds=CardLink]');
		if (found === null) throw new Error("no CardLink");
		return found;
	}

	it("focuses the editor on Backspace's keyup, swallowing the key's repeats until then", () => {
		const {container} = render(<LiveChips />);
		soloLink(container).focus();
		act(() => {
			fireEvent.keyDown(soloLink(container), {key: "Backspace"});
		});
		const afterKeyDown = {
			tiles: container.querySelectorAll("li").length,
			editor: document.activeElement === editor,
		};
		const repeatAllowed = fireEvent.keyDown(document.body, {key: "Backspace", repeat: true});
		fireEvent.keyUp(document.body, {key: "Backspace"});
		const laterRepeatAllowed = fireEvent.keyDown(editor, {key: "Backspace", repeat: true});
		expect({
			afterKeyDown,
			repeatAllowed,
			editor: document.activeElement === editor,
			laterRepeatAllowed,
		}).toStrictEqual({
			afterKeyDown: {tiles: 0, editor: false},
			repeatAllowed: false,
			editor: true,
			laterRepeatAllowed: true,
		});
	});

	it("cancels the hand-off when the window blurs before the keyup", () => {
		const {container} = render(<LiveChips />);
		soloLink(container).focus();
		act(() => {
			fireEvent.keyDown(soloLink(container), {key: "Backspace"});
		});
		fireEvent.blur(window);
		fireEvent.keyUp(document.body, {key: "Backspace"});
		expect(document.activeElement === editor).toBe(false);
	});

	it("leaves focus where it was on a pointer removal of the last tile", () => {
		const outside = document.createElement("button");
		document.body.append(outside);
		outside.focus();
		render(<LiveChips />);
		const remove = screen.getByRole("button", {name: "Remove solo.png"});
		fireEvent.mouseDown(remove);
		fireEvent.click(remove);
		const active = document.activeElement === outside;
		outside.remove();
		expect(active).toBe(true);
	});

	it("focuses the editor on Enter's keyup after Enter on the last tile's remove button", () => {
		render(<LiveChips />);
		const remove = screen.getByRole("button", {name: "Remove solo.png"});
		remove.focus();
		act(() => {
			fireEvent.keyDown(remove, {key: "Enter"});
		});
		const before = document.activeElement === editor;
		fireEvent.keyUp(document.body, {key: "Enter"});
		expect({
			before,
			after: document.activeElement === editor,
			tiles: document.querySelectorAll("li").length,
		}).toStrictEqual({
			before: false,
			after: true,
			tiles: 0,
		});
	});
});

describe("AttachedContextChips restored file tiles", () => {
	const KEY = `ccp-composer-attachments:${SESSION}`;
	const NOTES = "# Notes\n\n- one";

	function Live() {
		return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
	}

	function restore(name: string): HTMLElement {
		localStorage.setItem(KEY, JSON.stringify([{kind: "file", path: `/cache/attachments/${name}`, name}]));
		hydrateStagedChips(SESSION);
		const {container} = render(<Live />);
		return container.querySelector<HTMLElement>(`li[data-chip-label="${name}"]`)!;
	}

	afterEach(() => {
		for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
		localStorage.clear();
		vi.unstubAllGlobals();
	});

	it("gives a restored text file a keyboard-focusable CardLink", () => {
		const link = restore("notes.md").querySelector("[data-cds=CardLink]");
		expect({role: link?.getAttribute("role"), tabIndex: link?.getAttribute("tabindex")}).toStrictEqual({
			role: "button",
			tabIndex: "0",
		});
	});

	it("gives a restored .png-named or non-previewable file no CardLink", () => {
		const png = restore("shot.png").querySelector("[data-cds=CardLink]");
		cleanup();
		for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
		const zip = restore("bundle.zip").querySelector("[data-cds=CardLink]");
		expect({png, zip}).toStrictEqual({png: null, zip: null});
	});

	it("fetches a restored file's saved bytes once and opens the same preview a live upload opens", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(NOTES));
		vi.stubGlobal("fetch", fetchMock);
		restore("notes.md");
		const link = () => document.querySelector<HTMLElement>('li[data-chip-label="notes.md"] [data-cds=CardLink]')!;

		fireEvent.click(link());
		const first = await screen.findByRole("dialog");
		const opened = {
			title: first.querySelector("h2")?.textContent,
			description: first.querySelector("p")?.textContent,
			body: first.querySelector("div[dir=auto]")?.textContent,
		};
		fireEvent.keyDown(first, {key: "Escape"});
		await act(async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		});
		fireEvent.click(link());
		await screen.findByRole("dialog");

		expect({
			opened,
			fetches: fetchMock.mock.calls.map(([url]) => url),
		}).toStrictEqual({
			opened: {
				title: "notes.md",
				description: "0.01 KB\u00A0•3 lines•Formatting may be inconsistent from source",
				body: NOTES,
			},
			fetches: ["/api/attachments?path=%2Fcache%2Fattachments%2Fnotes.md"],
		});
	});
});

describe("AttachedContextChips motion", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		Reflect.deleteProperty(document, "startViewTransition");
	});

	it("names each tile's view transition after its id, with unsafe characters replaced", () => {
		const {container} = renderChips([{...IMAGE, id: "chip:1/a b"}]);
		const tile = container.querySelector<HTMLElement>("li[data-cds=MessageAttachmentsImage]");
		expect(tile?.style.getPropertyValue("--cds-attachment-vt-name")).toBe("cds-attachment-chip-1-a-b");
	});

	it("marks tiles present at mount as restored, and tiles added later as new", () => {
		const {container, rerender} = renderChips([IMAGE]);
		rerender(<AttachedContextChips sessionId={SESSION} context={[IMAGE, FILE]} comments={[]} />);
		expect(
			Array.from(container.querySelectorAll("li[data-cds-attachment]"), (li) => [
				li.getAttribute("data-chip-label"),
				li.getAttribute("data-cds-attachment-restored"),
			]),
		).toStrictEqual([
			["shot.png", ""],
			["notes.md", null],
		]);
	});

	it("takes restored ids from the caller when given, so a strip mounted by the first add animates it", () => {
		const {container} = render(
			<AttachedContextChips
				sessionId={SESSION}
				context={[IMAGE, FILE]}
				comments={[]}
				restoredIds={new Set(["chip-2"])}
			/>,
		);
		expect(
			Array.from(container.querySelectorAll("li[data-cds-attachment]"), (li) =>
				li.getAttribute("data-cds-attachment-restored"),
			),
		).toStrictEqual([null, ""]);
	});

	function stubTransitions(reduced: boolean) {
		const updates: (() => void)[] = [];
		const startViewTransition = vi.fn<(options: {types: string[]; update: () => void}) => void>((options) => {
			updates.push(options.update);
		});
		Object.assign(document, {startViewTransition});
		vi.stubGlobal("CSS", {
			supports: (query: string) => query === "selector(:active-view-transition-type(cds-attachments))",
		});
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: reduced && query === "(prefers-reduced-motion: reduce)",
			addEventListener: () => {},
			removeEventListener: () => {},
		}));
		return {startViewTransition, updates};
	}

	function LiveChips() {
		return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
	}

	function withLiveChip(run: () => void) {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		attachContext(SESSION, {kind: "image", path: "/cache/attachments/a.png", name: "a.png", previewUrl: "blob:a"});
		try {
			run();
		} finally {
			cleanup();
			takeContextChips(SESSION);
			stop();
		}
	}

	it("removes a tile inside a cds-attachments view transition", () => {
		const {startViewTransition, updates} = stubTransitions(false);
		withLiveChip(() => {
			render(<LiveChips />);
			fireEvent.click(screen.getByRole("button", {name: "Remove a.png"}));
			const during = document.querySelectorAll("li").length;
			act(() => {
				updates[0]?.();
			});
			expect({
				types: startViewTransition.mock.calls.map(([options]) => options.types),
				during,
				after: document.querySelectorAll("li").length,
			}).toStrictEqual({types: [["cds-attachments"]], during: 1, after: 0});
		});
	});

	it("removes at once with no view transition under reduced motion", () => {
		const {startViewTransition} = stubTransitions(true);
		withLiveChip(() => {
			render(<LiveChips />);
			fireEvent.click(screen.getByRole("button", {name: "Remove a.png"}));
			expect({
				calls: startViewTransition.mock.calls.length,
				tiles: document.querySelectorAll("li").length,
			}).toStrictEqual({
				calls: 0,
				tiles: 0,
			});
		});
	});

	it("removes at once with no view transition in a hidden tab", () => {
		const {startViewTransition} = stubTransitions(false);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		withLiveChip(() => {
			render(<LiveChips />);
			fireEvent.click(screen.getByRole("button", {name: "Remove a.png"}));
			expect({
				calls: startViewTransition.mock.calls.length,
				tiles: document.querySelectorAll("li").length,
			}).toStrictEqual({
				calls: 0,
				tiles: 0,
			});
		});
		vi.restoreAllMocks();
	});
});
