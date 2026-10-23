// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {AttachedContextChips} from "../src/components/attached-context-chips";
import type {ContextChip} from "../src/lib/context-attach";

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
			list: ["flex", "flex-wrap", "gap-[6px]", "justify-start", "w-full"],
		});
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
			img: {alt: img?.getAttribute("alt"), src: img?.getAttribute("src"), classes: classes(img)},
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
			srName: tile?.querySelector("[data-cds-card-body] > span.sr-only")?.textContent,
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
