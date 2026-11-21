// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {readFileSync} from "node:fs";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {AttachedContextChips} from "../src/components/attached-context-chips";
import {ToastProvider} from "../src/components/toast";
import
{
	attachContext,
	type ContextChip,
	getContextChips,
	hydrateStagedChips,
	removeContextChip,
	registerComposer,
	takeContextChips,
	useContextChips,
} from "../src/lib/context-attach";
import
{
	clearDiffComments,
	getDiffComments,
	openDiffCommentDraft,
	type QueuedDiffComment,
	saveDiffComment,
	useDiffComments,
} from "../src/lib/diff-comments";
import {ruleStart} from "./css-rule";
import {compileAll} from "./helpers/tailwind-design-system";

const SESSION = "session-alice";

const IMAGE: ContextChip =
{
	id: "chip-1",
	kind: "image",
	path: "/cache/attachments/1.png",
	name: "shot.png",
	previewUrl: "blob:shot",
};

const FILE: ContextChip =
{
	id: "chip-2",
	kind: "file",
	path: "/cache/attachments/2.md",
	name: "notes.md",
};

function classes(element: Element | null): string[]
{
	return (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).toSorted();
}

function renderChips(context: readonly ContextChip[])
{
	return render(<AttachedContextChips sessionId={SESSION} context={context} comments={[]} />);
}

afterEach(cleanup);

describe("AttachedContextChips cds tiles", () =>
{
	it("lays the tiles out in upstream's composer attachments tray", () =>
	{
		const {container} = renderChips([IMAGE]);
		const tray = container.querySelector("[data-cds-composer-attachments]");
		expect(
			{
				clip: classes(container.querySelector("[data-cds-composer-attachments-clip]")),
				tray: classes(tray),
				list: classes(tray?.querySelector('ul[aria-label="Attached context"]') ?? null),
			},
		).toStrictEqual(
			{
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
			},
		);
	});

	it("marks the tray list as upstream's composer MessageAttachments row", () =>
	{
		const {container} = renderChips([IMAGE]);
		const list = container.querySelector('ul[aria-label="Attached context"]');
		expect(
			{
				cds: list?.getAttribute("data-cds"),
				row: list?.getAttribute("data-cds-composer-attachments-row"),
			},
		).toStrictEqual(
			{
				cds: "MessageAttachments",
				row: "",
			},
		);
	});

	it("renders an image chip as a 120px cds tile with a zoom CardLink and a hover-revealed remove button", () =>
	{
		const {container} = renderChips([IMAGE]);
		const tile = container.querySelector("li[data-cds=MessageAttachmentsImage]");
		const card = tile?.querySelector("[data-cds=Card]") ?? null;
		const link = tile?.querySelector("[data-cds=CardLink]") ?? null;
		const img = link?.querySelector("img") ?? null;
		const remove = tile?.querySelector("button[data-cds-attachment-remove]") ?? null;
		expect(
			{
				attachment: tile?.getAttribute("data-cds-attachment"),
				tabIndex: tile?.getAttribute("tabindex"),
				tile: classes(tile ?? null),
				card: classes(card),
				fill: classes(card?.querySelector(".cds-card-fill") ?? null),
				link:
				{
					role: link?.getAttribute("role"),
					tabIndex: link?.getAttribute("tabindex"),
					classes: classes(link),
				},
				img:
				{
					alt: img?.getAttribute("alt"),
					src: img?.getAttribute("src"),
					loading: img?.getAttribute("loading"),
					decoding: img?.getAttribute("decoding"),
					width: img?.getAttribute("width"),
					height: img?.getAttribute("height"),
					classes: classes(img),
				},
				name: link?.querySelector("span.sr-only")?.textContent,
				remove:
				{
					label: remove?.getAttribute("aria-label"),
					classes: classes(remove),
				},
				glyph: tile?.querySelector("[data-attachment-glyph]") ?? null,
			},
		).toStrictEqual(
			{
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
				link:
				{
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
				img:
				{
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
				remove:
				{
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
			},
		);
	});

	it("hides an undecodable image and shows a centred Image glyph instead", () =>
	{
		const {container} = renderChips([IMAGE]);
		const img = container.querySelector("li[data-cds=MessageAttachmentsImage] img");
		if (img === null) throw new Error("no img");
		fireEvent.error(img);
		const glyph = container.querySelector("[data-attachment-glyph]");
		expect(
			{
				imgOpacity: classes(img).filter((name) => name.startsWith("opacity-")),
				glyph: classes(glyph),
				icon: glyph?.querySelector("svg") !== null,
			},
		).toStrictEqual(
			{
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
			},
		);
	});

	it("renders an uploaded file chip as a cds tile with its name and an extension badge", () =>
	{
		const {container} = renderChips([FILE]);
		const tile = container.querySelector("li[data-cds=MessageAttachmentsFile]");
		const name = tile?.querySelector("span[aria-hidden][title]") ?? null;
		const badge = tile?.querySelector("[data-cds=Badge]") ?? null;
		expect(
			{
				tile: classes(tile ?? null),
				srName: tile?.querySelector("[data-cds-card-body] span.sr-only")?.textContent,
				name:
				{
					title: name?.getAttribute("title"),
					classes: classes(name),
					bdi: name?.querySelector("bdi")?.textContent,
				},
				badge: badge?.textContent,
				remove: tile?.querySelector("button[data-cds-attachment-remove]")?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
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
				name:
				{
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
			},
		);
	});

	it("keeps a blank excerpt on upstream's 120px quote tile with a rail, the clamped text and an Excerpt badge", () =>
	{
		const {container} = renderChips([
			{
				id: "chip-e",
				kind: "excerpt",
				text: " \n ",
			},
		]);
		const tile = container.querySelector("li[data-cds=MessageAttachmentsQuote]");
		const link = tile?.querySelector("[data-cds=CardLink]") ?? null;
		const quote = tile?.querySelector("blockquote") ?? null;
		const remove = tile?.querySelector("button[data-cds-attachment-remove]") ?? null;
		expect(
			{
				attachment: tile?.getAttribute("data-cds-attachment"),
				tile: classes(tile ?? null),
				link:
				{
					role: link?.getAttribute("role"),
					tabIndex: link?.getAttribute("tabindex"),
					classes: classes(link),
				},
				srName: link?.querySelector("span.sr-only")?.textContent,
				row: classes(quote?.parentElement ?? null),
				rail: classes(quote?.previousElementSibling ?? null),
				quote:
				{
					dir: quote?.getAttribute("dir"),
					classes: classes(quote),
					text: quote?.textContent,
				},
				badge:
				{
					classes: classes(tile?.querySelector("[data-cds=Badge]") ?? null),
					text: tile?.querySelector("[data-cds=Badge]")?.textContent,
				},
				remove:
				{
					label: remove?.getAttribute("aria-label"),
					classes: classes(remove),
				},
			},
		).toStrictEqual(
			{
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
				link:
				{
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
				srName: " \n ",
				row: ["flex", "gap-xs", "min-h-0", "min-w-0"],
				rail: ["bg-border", "rounded-full", "self-stretch", "shrink-0", "w-[3px]"],
				quote:
				{
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
					text: "",
				},
				badge:
				{
					classes: [
						"align-middle",
						"bg-fill-ghost-hover",
						"font-medium",
						"font-sans",
						"gap-1",
						"h-control-nested",
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
				remove:
				{
					label: "Remove  \n ",
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
			},
		);
	});

	it("sizes an xs Card's Badge from the xs nested control height (18px comfortable, 16px compact) and xs caption", async () =>
	{
		const {container} = renderChips([
			{
				id: "chip-e",
				kind: "excerpt",
				text: " \n ",
			},
		]);
		const badge = container.querySelector("[data-cds=Badge]");
		const styles = readFileSync("src/styles/globals.css", "utf8");
		const xsStart = ruleStart(styles, '[data-size="xs"]');
		const xsRule = styles.slice(xsStart, styles.indexOf("}", xsStart));
		const sizing = classes(badge).filter((name) => /^(h-|text-caption$)/.test(name));
		const compiled = await compileAll(sizing);
		expect(
			{
				scope: badge?.closest("[data-size]")?.getAttribute("data-cds"),
				compiled,
				xs: xsRule.match(/--cds-h-control-nested:\s*([^;]+);|--upstream-text-caption:\s*([^;]+);/g),
			},
		).toStrictEqual(
			{
				scope: "Card",
				compiled:
				{
					"h-control-nested": ".h-control-nested { height: var(--cds-h-control-nested); }",
					"text-caption":
						".text-caption { font-size: var(--upstream-text-caption); line-height: var(--tw-leading, var(--upstream-leading-caption)); }",
				},
				xs: [
					"--cds-h-control-nested: var(--cds-h-control-nested--xs);",
					"--upstream-text-caption: var(--upstream-text-caption--xs);",
				],
			},
		);
	});

	it("removes an excerpt row from its remove button", () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "excerpt",
				text: "Hermit crabs",
			},
		);
		function Live()
		{
			return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
		}
		const {container} = render(<Live />);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Remove Excerpt, Hermit crabs",
				},
			),
		);
		const left = container.querySelector("[data-cds=MessageAttachmentsQuote]");
		cleanup();
		takeContextChips(SESSION);
		stop();
		expect(left).toBeNull();
	});

	describe("removal focus hand-off", () =>
	{
		const tiles: readonly ContextChip[] = [1, 2, 3].map((n) => (
		{
			id: `chip-${n}`,
			kind: "image",
			path: `/cache/attachments/${n}.png`,
			name: `shot-${n}.png`,
			previewUrl: `blob:shot-${n}`,
		}));

		function cardLink(container: HTMLElement, name: string): Element | null
		{
			return container.querySelector(`li[data-chip-label="${name}"] [data-cds=CardLink]`);
		}

		function removeWithKeyboard(container: HTMLElement, name: string): void
		{
			const remove = container.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name}"]`);
			if (remove === null) throw new Error(`no remove button for ${name}`);
			remove.focus();
			fireEvent.click(remove);
		}

		it("focuses the next tile's CardLink when a focused tile is removed", () =>
		{
			const {container, rerender} = renderChips(tiles);
			removeWithKeyboard(container, "shot-2.png");
			rerender(<AttachedContextChips sessionId={SESSION} context={[tiles[0]!, tiles[2]!]} comments={[]} />);
			expect(document.activeElement).toBe(cardLink(container, "shot-3.png"));
		});

		it("focuses the previous tile's CardLink when the focused last tile is removed", () =>
		{
			const {container, rerender} = renderChips(tiles);
			removeWithKeyboard(container, "shot-3.png");
			rerender(<AttachedContextChips sessionId={SESSION} context={[tiles[0]!, tiles[1]!]} comments={[]} />);
			expect(document.activeElement).toBe(cardLink(container, "shot-2.png"));
		});

		it("keeps focus where it was on a pointer removal", () =>
		{
			const editor = document.createElement("textarea");
			document.body.append(editor);
			editor.focus();
			const {container} = renderChips(tiles);
			const remove = container.querySelector('button[aria-label="Remove shot-2.png"]');
			if (remove === null) throw new Error("no remove button");
			const defaultAllowed = fireEvent.mouseDown(remove);
			fireEvent.click(remove);
			expect(
				{
					defaultAllowed,
					active: document.activeElement === editor,
				},
			).toStrictEqual(
				{
					defaultAllowed: false,
					active: true,
				},
			);
			editor.remove();
		});
	});

	describe("Delete/Backspace on a focused tile", () =>
	{
		const SHOTS = ["shot-1.png", "shot-2.png", "shot-3.png"];
		let stop: () => void = () =>
		{
		};

		function LiveChips()
		{
			return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
		}

		beforeEach(() =>
		{
			stop = registerComposer(
				SESSION,
				{
					insertText: () =>
					{
					},
					focus: () =>
					{
					},
				},
			);
			for (const name of SHOTS)
			{
				attachContext(
					SESSION,
					{
						kind: "image",
						path: `/cache/attachments/${name}`,
						name,
						previewUrl: `blob:${name}`,
					},
				);
			}
		});

		afterEach(() =>
		{
			cleanup();
			takeContextChips(SESSION);
			stop();
		});

		function link(container: HTMLElement, name: string): HTMLElement
		{
			const found = container.querySelector<HTMLElement>(`li[data-chip-label="${name}"] [data-cds=CardLink]`);
			if (found === null) throw new Error(`no CardLink for ${name}`);
			return found;
		}

		function tileNames(container: HTMLElement): (string | null)[]
		{
			return Array.from(container.querySelectorAll("li"), (li) => li.getAttribute("data-chip-label"));
		}

		it("removes the tile on Delete and focuses the next tile's CardLink", () =>
		{
			const {container} = render(<LiveChips />);
			link(container, "shot-2.png").focus();
			let defaultAllowed = true;
			act(() =>
			{
				defaultAllowed = fireEvent.keyDown(
					link(container, "shot-2.png"),
					{
						key: "Delete",
					},
				);
			});
			expect(
				{
					defaultAllowed,
					tiles: tileNames(container),
					focused: document.activeElement === link(container, "shot-3.png"),
				},
			).toStrictEqual(
				{
					defaultAllowed: false,
					tiles: ["shot-1.png", "shot-3.png"],
					focused: true,
				},
			);
		});

		it("removes the last tile on Backspace and focuses the previous tile's CardLink", () =>
		{
			const {container} = render(<LiveChips />);
			link(container, "shot-3.png").focus();
			act(() =>
			{
				fireEvent.keyDown(
					link(container, "shot-3.png"),
					{
						key: "Backspace",
					},
				);
			});
			expect(
				{
					tiles: tileNames(container),
					focused: document.activeElement === link(container, "shot-2.png"),
				},
			).toStrictEqual(
				{
					tiles: ["shot-1.png", "shot-2.png"],
					focused: true,
				},
			);
		});

		it.each([
			{
				name: "⌘",
				init:
				{
					metaKey: true,
				},
			},
			{
				name: "Ctrl",
				init:
				{
					ctrlKey: true,
				},
			},
			{
				name: "Alt",
				init:
				{
					altKey: true,
				},
			},
			{
				name: "Shift",
				init:
				{
					shiftKey: true,
				},
			},
			{
				name: "a repeat",
				init:
				{
					repeat: true,
				},
			},
			{
				name: "an IME composition",
				init:
				{
					isComposing: true,
				},
			},
		])("removes nothing with $name", ({init}) =>
		{
			const {container} = render(<LiveChips />);
			const target = link(container, "shot-2.png");
			target.focus();
			act(() =>
			{
				fireEvent.keyDown(
					target,
					{
						key: "Delete",
						...init,
					},
				);
				fireEvent.keyDown(
					target,
					{
						key: "Backspace",
						...init,
					},
				);
			});
			expect(
				{
					tiles: tileNames(container),
					focused: document.activeElement === target,
				},
			).toStrictEqual(
				{
					tiles: SHOTS,
					focused: true,
				},
			);
		});
	});

	describe("image preview", () =>
	{
		beforeEach(() =>
		{
			vi.stubGlobal("matchMedia", (query: string) => (
			{
				matches: false,
				media: query,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
			}));
		});

		afterEach(() =>
		{
			vi.unstubAllGlobals();
		});

		function imageLink(container: HTMLElement): HTMLElement
		{
			const link = container.querySelector<HTMLElement>(
				"li[data-cds=MessageAttachmentsImage] [data-cds=CardLink]",
			);
			if (link === null) throw new Error("no image CardLink");
			return link;
		}

		async function previewOf(): Promise<
		{
			src: string | null;
			alt: string | null;
		}>
		{
			const dialog = await screen.findByRole("dialog");
			const img = dialog.querySelector("img");
			return {
				src: img?.getAttribute("src") ?? null,
				alt: img?.getAttribute("alt") ?? null,
			};
		}

		it("opens the preview of a ready image on click, hiding the tile's image", async () =>
		{
			const {container} = renderChips([IMAGE]);
			const link = imageLink(container);
			link.focus();
			fireEvent.click(link);
			expect(
				{
					preview: await previewOf(),
					tileVisibility: link.querySelector("img")?.style.visibility,
				},
			).toStrictEqual(
				{
					preview:
					{
						src: "blob:shot",
						alt: "shot.png",
					},
					tileVisibility: "hidden",
				},
			);
		});

		it.each(["Enter", " "])("opens the preview on %j", async (key) =>
		{
			const {container} = renderChips([IMAGE]);
			const link = imageLink(container);
			link.focus();
			const defaultAllowed = fireEvent.keyDown(
				link,
				{
					key,
				},
			);
			expect(
				{
					defaultAllowed,
					preview: await previewOf(),
				},
			).toStrictEqual(
				{
					defaultAllowed: false,
					preview:
					{
						src: "blob:shot",
						alt: "shot.png",
					},
				},
			);
		});

		it("closes on Escape, refocusing the tile's CardLink and showing its image again", async () =>
		{
			const {container} = renderChips([IMAGE]);
			const link = imageLink(container);
			link.focus();
			fireEvent.click(link);
			const dialog = await screen.findByRole("dialog");
			act(() =>
			{
				fireEvent.keyDown(
					dialog,
					{
						key: "Escape",
					},
				);
			});
			expect(
				{
					dialog: screen.queryByRole("dialog"),
					focused: document.activeElement === link,
					tileVisibility: link.querySelector("img")?.style.visibility,
				},
			).toStrictEqual(
				{
					dialog: null,
					focused: true,
					tileVisibility: "",
				},
			);
		});

		it("names a pending image by its alt, with upstream's lazy 120x120 img attributes", () =>
		{
			const {container} = renderChips([
				{
					...IMAGE,
					status: "pending",
				},
			]);
			const img = container.querySelector("li[data-cds=MessageAttachmentsImage] img");
			expect(
				{
					alt: img?.getAttribute("alt"),
					loading: img?.getAttribute("loading"),
					decoding: img?.getAttribute("decoding"),
					width: img?.getAttribute("width"),
					height: img?.getAttribute("height"),
					link: container.querySelector("[data-cds=CardLink]"),
				},
			).toStrictEqual(
				{
					alt: "shot.png",
					loading: "lazy",
					decoding: "async",
					width: "120",
					height: "120",
					link: null,
				},
			);
		});

		it("gives a pending image no CardLink to open", () =>
		{
			const {container} = renderChips([
				{
					...IMAGE,
					status: "pending",
				},
			]);
			const tile = container.querySelector<HTMLElement>("li[data-cds=MessageAttachmentsImage]");
			if (tile === null) throw new Error("no tile");
			fireEvent.click(tile.querySelector("img") ?? tile);
			expect(
				{
					link: tile.querySelector("[data-cds=CardLink]"),
					dialog: screen.queryByRole("dialog"),
				},
			).toStrictEqual(
				{
					link: null,
					dialog: null,
				},
			);
		});

		it("removes the open preview when the strip unmounts", async () =>
		{
			const {container, unmount} = renderChips([IMAGE]);
			fireEvent.click(imageLink(container));
			await screen.findByRole("dialog");
			unmount();
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});
});

describe("AttachedContextChips text preview", () =>
{
	const MESSAGE: ContextChip =
	{
		id: "chip-m",
		kind: "message",
		text: "hello\nworld",
	};
	const SELECTION: ContextChip =
	{
		id: "chip-s",
		kind: "selection",
		path: "/w/src/a.ts",
		range:
		{
			start: 1,
			end: 3,
		},
		text: "one\ntwo\nthree",
		language: "ts",
	};
	const TERMINAL: ContextChip =
	{
		id: "chip-t",
		kind: "terminal",
		text: "$ ls\nREADME.md",
	};

	function linkOf(container: HTMLElement, label: string): HTMLElement
	{
		const link = container.querySelector<HTMLElement>(`li[data-chip-label="${label}"] [data-cds=CardLink]`);
		if (link === null) throw new Error(`no CardLink for ${label}`);
		return link;
	}

	async function openedPreview()
	{
		const dialog = await screen.findByRole("dialog");
		return {
			title: dialog.querySelector("h2")?.textContent,
			variant: dialog.querySelector("blockquote") === null ? "file" : "excerpt",
			text: (dialog.querySelector("blockquote") ?? dialog.querySelector("div[dir=auto]"))?.textContent,
		};
	}

	it("gives message, selection and terminal pills a keyboard-focusable CardLink with the default cursor", () =>
	{
		const {container} = renderChips([MESSAGE, SELECTION, TERMINAL]);
		const links = ["Message", "a.ts:1-3", "Terminal output"].map((label) =>
		{
			const link = linkOf(container, label);
			return {
				role: link.getAttribute("role"),
				tabIndex: link.getAttribute("tabindex"),
				classes: classes(link),
			};
		});
		const expected =
		{
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

	it("opens a message as an Excerpt", async () =>
	{
		const {container} = renderChips([MESSAGE]);
		fireEvent.click(linkOf(container, "Message"));
		expect(await openedPreview()).toStrictEqual(
			{
				title: "Excerpt",
				variant: "excerpt",
				text: "hello\nworld",
			},
		);
	});

	it("opens an excerpt row as an Excerpt", async () =>
	{
		const {container} = renderChips([
			{
				id: "chip-e",
				kind: "excerpt",
				text: "Hermit crabs",
			},
		]);
		const link = container.querySelector<HTMLElement>("[data-cds=MessageAttachmentsQuote] [data-cds=CardLink]");
		if (link === null) throw new Error("no excerpt CardLink");
		fireEvent.click(link);
		expect(await openedPreview()).toStrictEqual(
			{
				title: "Excerpt",
				variant: "excerpt",
				text: "Hermit crabs",
			},
		);
	});

	it("opens a selection as a file titled by its label", async () =>
	{
		const {container} = renderChips([SELECTION]);
		fireEvent.click(linkOf(container, "a.ts:1-3"));
		expect(await openedPreview()).toStrictEqual(
			{
				title: "a.ts:1-3",
				variant: "file",
				text: "one\ntwo\nthree",
			},
		);
	});

	it.each(["Enter", " "])("opens terminal output on %j", async (key) =>
	{
		const {container} = renderChips([TERMINAL]);
		const defaultAllowed = fireEvent.keyDown(
			linkOf(container, "Terminal output"),
			{
				key,
			},
		);
		expect(
			{
				defaultAllowed,
				preview: await openedPreview(),
			},
		).toStrictEqual(
			{
				defaultAllowed: false,
				preview:
				{
					title: "Terminal output",
					variant: "file",
					text: "$ ls\nREADME.md",
				},
			},
		);
	});

	it("opens a pasted-text pill as a file titled Pasted text", async () =>
	{
		const {container} = renderChips([
			{
				id: "chip-x",
				kind: "pasted-text",
				text: "alpha\nbeta",
			},
		]);
		fireEvent.click(linkOf(container, "Pasted text · 2 lines"));
		expect(await openedPreview()).toStrictEqual(
			{
				title: "Pasted text",
				variant: "file",
				text: "alpha\nbeta",
			},
		);
	});

	it("closes on Escape, refocusing the pill's CardLink", async () =>
	{
		const {container} = renderChips([MESSAGE]);
		const link = linkOf(container, "Message");
		link.focus();
		fireEvent.click(link);
		const dialog = await screen.findByRole("dialog");
		act(() =>
		{
			fireEvent.keyDown(
				dialog,
				{
					key: "Escape",
				},
			);
		});
		await vi.waitFor(() =>
		{
			expect(screen.queryByRole("dialog")).toBeNull();
		});
		expect(document.activeElement === link).toBe(true);
	});

	it("gives a path chip with no text nothing to open", () =>
	{
		const {container} = renderChips([
			{
				id: "chip-p",
				kind: "file",
				path: "/w/src/a.ts",
			},
		]);
		expect(container.querySelector("[data-cds=CardLink]")).toBeNull();
	});
});

describe("AttachedContextChips path chip file actions", () =>
{
	function renderWithCwd(context: readonly ContextChip[])
	{
		return render(
			<ToastProvider>
				<AttachedContextChips sessionId={SESSION} context={context} comments={[]} cwd="/w" />
			</ToastProvider>,
		);
	}

	function chipOf(container: HTMLElement, label: string): HTMLElement
	{
		const chip = container.querySelector<HTMLElement>(`li[data-chip-label="${label}"]`);
		if (chip === null) throw new Error(`no chip ${label}`);
		return chip;
	}

	/** The newest open menu's rows, top to bottom: item labels, with "─" for separators. */
	function menuRows(): string[]
	{
		const menu = screen.getAllByRole("menu").at(-1);
		if (menu === undefined) throw new Error("no menu open");
		return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator" ? "─" : (row.firstElementChild?.textContent ?? row.textContent),
		);
	}

	async function openSubmenu(label: string): Promise<string[]>
	{
		const trigger = screen
			.getAllByRole("menuitem")
			.find((row) => (row.firstElementChild?.textContent ?? row.textContent) === label);
		if (trigger === undefined) throw new Error(`no item ${label}`);
		fireEvent.click(trigger);
		return vi.waitFor(() =>
		{
			const rows = menuRows();
			if (rows.includes(label)) throw new Error(`${label} ▸ not open`);
			return rows;
		});
	}

	it("a file chip's right-click lists Copy ▸ · ─ · Open in ▸ · Show in Finder, without Attach as context", async () =>
	{
		const {container} = renderWithCwd([
			{
				id: "chip-p",
				kind: "file",
				path: "src/a.ts",
			},
		]);
		const notPrevented = fireEvent.contextMenu(
			chipOf(container, "a.ts"),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		const rows = await vi.waitFor(() => menuRows());
		const copyRows = await openSubmenu("Copy");

		expect(
			{
				notPrevented,
				rows,
				copyRows,
			},
		).toStrictEqual(
			{
				notPrevented: false,
				rows: ["Copy", "─", "Open in", "Show in Finder"],
				copyRows: ["Absolute path", "Relative path", "Filename"],
			},
		);
	});

	it("a folder chip has no Default app row", async () =>
	{
		const {container} = renderWithCwd([
			{
				id: "chip-d",
				kind: "file",
				path: "docs/",
			},
		]);
		fireEvent.contextMenu(
			chipOf(container, "docs/"),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		await vi.waitFor(() => menuRows());

		expect(await openSubmenu("Open in")).toStrictEqual(["VS Code"]);
	});

	it("a plain click on a path chip opens nothing", () =>
	{
		const {container} = renderWithCwd([
			{
				id: "chip-p",
				kind: "file",
				path: "src/a.ts",
			},
		]);
		fireEvent.click(chipOf(container, "a.ts"));

		expect(screen.queryAllByRole("menu")).toStrictEqual([]);
	});

	it("image and uploaded-file chips get no menu: their right-click isn't default-prevented", () =>
	{
		const {container} = renderWithCwd([IMAGE, FILE]);
		const results = [IMAGE, FILE].map((chip) =>
			fireEvent.contextMenu(
				chipOf(container, chip.name ?? ""),
				{
					clientX: 10,
					clientY: 10,
				},
			),
		);

		expect(
			{
				results,
				menus: screen.queryAllByRole("menu"),
			},
		).toStrictEqual(
			{
				results: [true, true],
				menus: [],
			},
		);
	});
});

/** Lays each tile out 126px apart from x=0 in a 300px-wide row, shifted by the row's scrollLeft. */
function stubRowGeometry(container: HTMLElement)
{
	const row = container.querySelector<HTMLElement>('ul[aria-label="Attached context"]');
	if (row === null) throw new Error("no row");
	const scrollTo = vi.fn<(options: ScrollToOptions) => void>();
	Object.assign(
		row,
		{
			scrollTo,
		},
	);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function rect(this: HTMLElement)
	{
		if (this === row)
			return DOMRect.fromRect(
				{
					x: 0,
					y: 0,
					width: 300,
					height: 136,
				},
			);
		const tiles = [...row.children];
		const index = tiles.indexOf(this);
		return DOMRect.fromRect(
			{
				x: index * 126 - row.scrollLeft,
				y: 8,
				width: 120,
				height: 120,
			},
		);
	});
	return {
		row,
		scrollTo,
	};
}

function shot(n: number): ContextChip
{
	return {
		id: `chip-${n}`,
		kind: "image",
		path: `/cache/attachments/${n}.png`,
		name: `shot-${n}.png`,
		previewUrl: `blob:shot-${n}`,
	};
}

describe("AttachedContextChips scrolling row", () =>
{
	afterEach(() =>
	{
		vi.restoreAllMocks();
	});

	it("scrolls a tile added after mount into the row's view, but not tiles present at mount", () =>
	{
		const {container, rerender} = renderChips([shot(1), shot(2)]);
		const {scrollTo} = stubRowGeometry(container);
		rerender(<AttachedContextChips sessionId={SESSION} context={[shot(1), shot(2)]} comments={[]} />);
		const atMount = scrollTo.mock.calls.length;
		rerender(<AttachedContextChips sessionId={SESSION} context={[shot(1), shot(2), shot(3)]} comments={[]} />);
		// Tile 3 spans 252-372 in a 300px row: scroll right by 72px.
		expect(
			{
				atMount,
				calls: scrollTo.mock.calls,
			},
		).toStrictEqual(
			{
				atMount: 0,
				calls: [
					[
						{
							left: 72,
							behavior: "instant",
						},
					],
				],
			},
		);
	});

	it("leaves the row alone when a new tile is already in view", () =>
	{
		const {container, rerender} = renderChips([shot(1)]);
		const {scrollTo} = stubRowGeometry(container);
		rerender(<AttachedContextChips sessionId={SESSION} context={[shot(1), shot(2)]} comments={[]} />);
		expect(scrollTo.mock.calls).toStrictEqual([]);
	});

	it("scrolls a keyboard-focused tile into view on focusin, not a pointer-focused one", () =>
	{
		const {container} = renderChips([shot(1), shot(2), shot(3)]);
		const {scrollTo} = stubRowGeometry(container);
		const link = container.querySelector<HTMLElement>('li[data-chip-label="shot-3.png"] [data-cds=CardLink]');
		if (link === null) throw new Error("no CardLink");
		const matches = vi.spyOn(link, "matches").mockReturnValue(false);
		fireEvent.focusIn(link);
		const pointer = scrollTo.mock.calls.length;
		matches.mockImplementation((selector: string) => selector === ":focus-visible");
		fireEvent.focusIn(link);
		expect(
			{
				pointer,
				calls: scrollTo.mock.calls,
			},
		).toStrictEqual(
			{
				pointer: 0,
				calls: [
					[
						{
							left: 72,
							behavior: "instant",
						},
					],
				],
			},
		);
	});

	it("focuses the next tile without scrolling on keyboard removal, then scrolls it into view once the old tile is gone", async () =>
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		for (const n of [1, 2, 3])
		{
			attachContext(
				SESSION,
				{
					kind: "image",
					path: `/cache/attachments/${n}.png`,
					name: `shot-${n}.png`,
					previewUrl: `blob:${n}`,
				},
			);
		}
		function Live()
		{
			return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
		}
		const {container} = render(<Live />);
		const {row, scrollTo} = stubRowGeometry(container);
		row.scrollLeft = 0;
		// jsdom's selector engine decides :focus-visible from the window's last key or pointer event and last
		// focus-visible node, which earlier tests leave behind, so pin it: this test covers the hand-off's own
		// scroll; the focusin scroll of a keyboard-focused tile is the test above.
		const matches = HTMLElement.prototype.matches;
		vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, selector: string)
		{
			return selector === ":focus-visible" ? false : matches.call(this, selector);
		});
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		const link = (name: string) =>
			container.querySelector<HTMLElement>(`li[data-chip-label="${name}"] [data-cds=CardLink]`)!;
		link("shot-2.png").focus();
		focus.mockClear();
		act(() =>
		{
			fireEvent.keyDown(
				link("shot-2.png"),
				{
					key: "Delete",
				},
			);
		});
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
		const result =
		{
			focusedNext: document.activeElement === link("shot-3.png"),
			focusArgs: focus.mock.calls,
			// Tile 3 now sits second, at 126-246: inside the 300px row, so no scroll is needed.
			scrolls: scrollTo.mock.calls,
		};
		cleanup();
		takeContextChips(SESSION);
		stop();
		expect(result).toStrictEqual(
			{
				focusedNext: true,
				focusArgs: [
					[
						{
							preventScroll: true,
						},
					],
				],
				scrolls: [],
			},
		);
	});
});

describe("AttachedContextChips last-tile keyboard removal", () =>
{
	let stop: () => void = () =>
	{
	};
	let editor: HTMLTextAreaElement;

	function LiveChips()
	{
		return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
	}

	beforeEach(() =>
	{
		editor = document.createElement("textarea");
		document.body.append(editor);
		stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
					editor.focus();
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "image",
				path: "/cache/attachments/solo.png",
				name: "solo.png",
				previewUrl: "blob:solo",
			},
		);
		editor.blur();
	});

	afterEach(() =>
	{
		cleanup();
		takeContextChips(SESSION);
		stop();
		editor.remove();
	});

	function soloLink(container: HTMLElement): HTMLElement
	{
		const found = container.querySelector<HTMLElement>('li[data-chip-label="solo.png"] [data-cds=CardLink]');
		if (found === null) throw new Error("no CardLink");
		return found;
	}

	it("focuses the editor on Backspace's keyup, swallowing the key's repeats until then", () =>
	{
		const {container} = render(<LiveChips />);
		soloLink(container).focus();
		act(() =>
		{
			fireEvent.keyDown(
				soloLink(container),
				{
					key: "Backspace",
				},
			);
		});
		const afterKeyDown =
		{
			tiles: container.querySelectorAll("li").length,
			editor: document.activeElement === editor,
		};
		const repeatAllowed = fireEvent.keyDown(
			document.body,
			{
				key: "Backspace",
				repeat: true,
			},
		);
		fireEvent.keyUp(
			document.body,
			{
				key: "Backspace",
			},
		);
		const laterRepeatAllowed = fireEvent.keyDown(
			editor,
			{
				key: "Backspace",
				repeat: true,
			},
		);
		expect(
			{
				afterKeyDown,
				repeatAllowed,
				editor: document.activeElement === editor,
				laterRepeatAllowed,
			},
		).toStrictEqual(
			{
				afterKeyDown:
				{
					tiles: 0,
					editor: false,
				},
				repeatAllowed: false,
				editor: true,
				laterRepeatAllowed: true,
			},
		);
	});

	it("cancels the hand-off when the window blurs before the keyup", () =>
	{
		const {container} = render(<LiveChips />);
		soloLink(container).focus();
		act(() =>
		{
			fireEvent.keyDown(
				soloLink(container),
				{
					key: "Backspace",
				},
			);
		});
		fireEvent.blur(window);
		fireEvent.keyUp(
			document.body,
			{
				key: "Backspace",
			},
		);
		expect(document.activeElement === editor).toBe(false);
	});

	it("leaves focus where it was on a pointer removal of the last tile", () =>
	{
		const outside = document.createElement("button");
		document.body.append(outside);
		outside.focus();
		render(<LiveChips />);
		const remove = screen.getByRole(
			"button",
			{
				name: "Remove solo.png",
			},
		);
		fireEvent.mouseDown(remove);
		fireEvent.click(remove);
		const active = document.activeElement === outside;
		outside.remove();
		expect(active).toBe(true);
	});

	it("focuses the editor on Enter's keyup after Enter on the last tile's remove button", () =>
	{
		render(<LiveChips />);
		const remove = screen.getByRole(
			"button",
			{
				name: "Remove solo.png",
			},
		);
		remove.focus();
		act(() =>
		{
			fireEvent.keyDown(
				remove,
				{
					key: "Enter",
				},
			);
		});
		const before = document.activeElement === editor;
		fireEvent.keyUp(
			document.body,
			{
				key: "Enter",
			},
		);
		expect(
			{
				before,
				after: document.activeElement === editor,
				tiles: document.querySelectorAll("li").length,
			},
		).toStrictEqual(
			{
				before: false,
				after: true,
				tiles: 0,
			},
		);
	});
});

describe("AttachedContextChips restored file tiles", () =>
{
	const KEY = `ccp-composer-attachments:${SESSION}`;
	const NOTES = "# Notes\n\n- one";

	function Live()
	{
		return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
	}

	function restore(name: string): HTMLElement
	{
		localStorage.setItem(
			KEY,
			JSON.stringify([
				{
					kind: "file",
					path: `/cache/attachments/${name}`,
					name,
				},
			]),
		);
		hydrateStagedChips(SESSION);
		const {container} = render(<Live />);
		return container.querySelector<HTMLElement>(`li[data-chip-label="${name}"]`)!;
	}

	afterEach(() =>
	{
		for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
		localStorage.clear();
		vi.unstubAllGlobals();
	});

	it("gives a restored text file a keyboard-focusable CardLink", () =>
	{
		const link = restore("notes.md").querySelector("[data-cds=CardLink]");
		expect(
			{
				role: link?.getAttribute("role"),
				tabIndex: link?.getAttribute("tabindex"),
			},
		).toStrictEqual(
			{
				role: "button",
				tabIndex: "0",
			},
		);
	});

	it("gives a restored .png-named or non-previewable file no CardLink", () =>
	{
		const png = restore("shot.png").querySelector("[data-cds=CardLink]");
		cleanup();
		for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
		const zip = restore("bundle.zip").querySelector("[data-cds=CardLink]");
		expect(
			{
				png,
				zip,
			},
		).toStrictEqual(
			{
				png: null,
				zip: null,
			},
		);
	});

	it("fetches a restored file's saved bytes once and opens the same preview a live upload opens", async () =>
	{
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(NOTES));
		vi.stubGlobal("fetch", fetchMock);
		restore("notes.md");
		const link = () => document.querySelector<HTMLElement>('li[data-chip-label="notes.md"] [data-cds=CardLink]')!;

		fireEvent.click(link());
		const first = await screen.findByRole("dialog");
		const opened =
		{
			title: first.querySelector("h2")?.textContent,
			description: first.querySelector("p")?.textContent,
			body: first.querySelector("div[dir=auto]")?.textContent,
		};
		fireEvent.keyDown(
			first,
			{
				key: "Escape",
			},
		);
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
		fireEvent.click(link());
		await screen.findByRole("dialog");

		expect(
			{
				opened,
				fetches: fetchMock.mock.calls.map(([url]) => url),
			},
		).toStrictEqual(
			{
				opened:
				{
					title: "notes.md",
					description: "0.01 KB\u00A0•3 lines•Formatting may be inconsistent from source",
					body: NOTES,
				},
				fetches: ["/api/attachments?path=%2Fcache%2Fattachments%2Fnotes.md"],
			},
		);
	});
});

describe("AttachedContextChips motion", () =>
{
	afterEach(() =>
	{
		vi.unstubAllGlobals();
		Reflect.deleteProperty(document, "startViewTransition");
	});

	it("names each tile's view transition after its id, with unsafe characters replaced", () =>
	{
		const {container} = renderChips([
			{
				...IMAGE,
				id: "chip:1/a b",
			},
		]);
		const tile = container.querySelector<HTMLElement>("li[data-cds=MessageAttachmentsImage]");
		expect(tile?.style.getPropertyValue("--cds-attachment-vt-name")).toBe("cds-attachment-chip-1-a-b");
	});

	it("marks tiles present at mount as restored, and tiles added later as new", () =>
	{
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

	it("takes restored ids from the caller when given, so a strip mounted by the first add animates it", () =>
	{
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

	function stubTransitions(reduced: boolean)
	{
		const updates: (() => void)[] = [];
		const startViewTransition = vi.fn<(options: {types: string[]; update: () => void}) => void>((options) =>
		{
			updates.push(options.update);
		});
		Object.assign(
			document,
			{
				startViewTransition,
			},
		);
		vi.stubGlobal(
			"CSS",
			{
				supports: (query: string) => query === "selector(:active-view-transition-type(cds-attachments))",
			},
		);
		vi.stubGlobal("matchMedia", (query: string) => (
		{
			matches: reduced && query === "(prefers-reduced-motion: reduce)",
			addEventListener: () =>
			{
			},
			removeEventListener: () =>
			{
			},
		}));
		return {
			startViewTransition,
			updates,
		};
	}

	function LiveChips()
	{
		return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
	}

	function withLiveChip(run: () => void)
	{
		const stop = registerComposer(
			SESSION,
			{
				insertText: () =>
				{
				},
				focus: () =>
				{
				},
			},
		);
		attachContext(
			SESSION,
			{
				kind: "image",
				path: "/cache/attachments/a.png",
				name: "a.png",
				previewUrl: "blob:a",
			},
		);
		try
		{
			run();
		}
		finally
		{
			cleanup();
			takeContextChips(SESSION);
			stop();
		}
	}

	it("removes a tile inside a cds-attachments view transition", () =>
	{
		const {startViewTransition, updates} = stubTransitions(false);
		withLiveChip(() =>
		{
			render(<LiveChips />);
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Remove a.png",
					},
				),
			);
			const during = document.querySelectorAll("li").length;
			act(() =>
			{
				updates[0]?.();
			});
			expect(
				{
					types: startViewTransition.mock.calls.map(([options]) => options.types),
					during,
					after: document.querySelectorAll("li").length,
				},
			).toStrictEqual(
				{
					types: [["cds-attachments"]],
					during: 1,
					after: 0,
				},
			);
		});
	});

	it("removes at once with no view transition under reduced motion", () =>
	{
		const {startViewTransition} = stubTransitions(true);
		withLiveChip(() =>
		{
			render(<LiveChips />);
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Remove a.png",
					},
				),
			);
			expect(
				{
					calls: startViewTransition.mock.calls.length,
					tiles: document.querySelectorAll("li").length,
				},
			).toStrictEqual(
				{
					calls: 0,
					tiles: 0,
				},
			);
		});
	});

	it("removes at once with no view transition in a hidden tab", () =>
	{
		const {startViewTransition} = stubTransitions(false);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		withLiveChip(() =>
		{
			render(<LiveChips />);
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Remove a.png",
					},
				),
			);
			expect(
				{
					calls: startViewTransition.mock.calls.length,
					tiles: document.querySelectorAll("li").length,
				},
			).toStrictEqual(
				{
					calls: 0,
					tiles: 0,
				},
			);
		});
		vi.restoreAllMocks();
	});
});

describe("AttachedContextChips queued comment tiles", () =>
{
	function queue(target: Parameters<typeof openDiffCommentDraft>[1], text: string): void
	{
		saveDiffComment(SESSION, openDiffCommentDraft(SESSION, target), text);
	}

	function LiveComments({restoredIds}: {restoredIds?: ReadonlySet<string>})
	{
		return (
			<AttachedContextChips
				sessionId={SESSION}
				context={[]}
				comments={useDiffComments(SESSION).queued}
				restoredIds={restoredIds}
			/>
		);
	}

	beforeEach(() =>
	{
		queue(
			{
				path: "src/demo.ts",
				side: "additions",
				line: 3,
			},
			"Rename this constant",
		);
		queue(
			{
				path: "src/demo.ts",
				side: "deletions",
				line: 5,
				endLine: 7,
			},
			"Restore it",
		);
	});

	afterEach(() =>
	{
		cleanup();
		clearDiffComments(SESSION);
	});

	function texts(container: HTMLElement, selector: string): (string | null)[]
	{
		return Array.from(container.querySelectorAll(selector), (element) => element.textContent);
	}

	it("renders each queued comment as upstream's Comment Quote tile, never restored", () =>
	{
		const [first] = getDiffComments(SESSION).queued;
		const {container} = render(<LiveComments restoredIds={new Set([first?.id ?? ""])} />);
		const tiles = Array.from(container.querySelectorAll("[data-cds=MessageAttachmentsQuote]"));
		expect(
			{
				names: texts(container, "[data-cds=CardLink] > .sr-only"),
				quotes: texts(container, "blockquote"),
				badges: tiles.map((tile) =>
				{
					const badge = tile.querySelector("[data-cds=Badge]");
					const hint = document.getElementById(badge?.getAttribute("aria-describedby") ?? "");
					return {
						role: badge?.getAttribute("role"),
						label: badge?.getAttribute("aria-label"),
						tabIndex: badge?.getAttribute("tabindex"),
						hint: hint?.textContent,
						hidden: hint?.hidden,
					};
				}),
				describedBy: tiles.map((tile) =>
					(tile.querySelector("[data-cds=CardLink]")?.getAttribute("aria-describedby") ?? "")
						.split(" ")
						.map((id) => document.getElementById(id)?.tagName ?? null),
				),
				removes: screen
					.getAllByRole("button")
					.map((button) => button.getAttribute("aria-label"))
					.filter((label) => label?.startsWith("Remove ")),
				restored: tiles.map((tile) => tile.hasAttribute("data-cds-attachment-restored")),
			},
		).toStrictEqual(
			{
				names: ["Comment on demo.ts:3", "Comment on demo.ts:5-7 (before changes)"],
				quotes: ["Rename this constant", "Restore it"],
				badges: [
					{
						role: "img",
						label: "Comment",
						tabIndex: "0",
						hint: "demo.ts:3",
						hidden: true,
					},
					{
						role: "img",
						label: "Comment",
						tabIndex: "0",
						hint: "demo.ts:5-7 (before changes)",
						hidden: true,
					},
				],
				describedBy: [
					["BLOCKQUOTE", "SPAN", "SPAN"],
					["BLOCKQUOTE", "SPAN", "SPAN"],
				],
				removes: ["Remove Comment on demo.ts:3", "Remove Comment on demo.ts:5-7 (before changes)"],
				restored: [false, false],
			},
		);
	});

	it("removes a focused comment tile on Delete and focuses the next tile's CardLink", () =>
	{
		const {container} = render(<LiveComments />);
		const links = () => Array.from(container.querySelectorAll<HTMLElement>("[data-cds=CardLink]"));
		links()[0]?.focus();
		act(() =>
		{
			fireEvent.keyDown(
				links()[0] ?? document.body,
				{
					key: "Delete",
				},
			);
		});
		expect(
			{
				queued: getDiffComments(SESSION).queued.map(({text}) => text),
				focused: document.activeElement === links()[0],
				names: texts(container, "[data-cds=CardLink] > .sr-only"),
			},
		).toStrictEqual(
			{
				queued: ["Restore it"],
				focused: true,
				names: ["Comment on demo.ts:5-7 (before changes)"],
			},
		);
	});

	it("quotes the where label for a comment whose text is only whitespace", () =>
	{
		const blank: QueuedDiffComment =
		{
			id: "blank",
			path: "src/demo.ts",
			side: "additions",
			line: 3,
			text: "   ",
		};
		const {container} = render(<AttachedContextChips sessionId={SESSION} context={[]} comments={[blank]} />);
		expect(texts(container, "blockquote")).toStrictEqual(["demo.ts:3"]);
	});
});

describe("AttachedContextChips quote rows", () =>
{
	const REPLY: ContextChip =
	{
		id: "r1",
		kind: "excerpt",
		text: "The build step runs vitest first and then the typecheck.",
		comment: "Swap these so the typecheck fails fast",
	};
	const PLAIN: ContextChip =
	{
		id: "e1",
		kind: "excerpt",
		text: "Plain excerpt without a comment",
	};
	const REPLY_NAME =
		"Your reply to “The build step runs vitest first and th…”: Swap these so the typecheck fails fast";

	function rows(container: HTMLElement): HTMLElement[]
	{
		return Array.from(
			container.querySelectorAll<HTMLElement>("[data-cds=ChatComposerQuotes] > [data-variant=row]"),
		);
	}

	function describedBy(element: Element | null | undefined): (string | null)[]
	{
		return (element?.getAttribute("aria-describedby") ?? "")
			.split(" ")
			.filter(Boolean)
			.map((id) => document.getElementById(id)?.tagName ?? null);
	}

	function rowShape(row: HTMLElement)
	{
		const link = row.querySelector("[data-cds=CardLink]");
		const badge = row.querySelector("[data-cds=Badge]");
		return {
			name: link?.querySelector(".sr-only")?.textContent,
			quote: row.querySelector("blockquote span[dir=auto]")?.textContent,
			badge: badge?.getAttribute("aria-label") ?? null,
			hint: document.getElementById(badge?.getAttribute("aria-describedby") ?? "")?.textContent ?? null,
			describedBy: describedBy(link),
			remove: row.querySelector("button[data-cds-attachment-remove]")?.getAttribute("aria-label"),
		};
	}

	it("stages replies and plain excerpts as upstream's ChatComposerQuotes rows above the tile row, in staging order", () =>
	{
		const {container} = render(
			<AttachedContextChips
				sessionId={SESSION}
				context={[REPLY, IMAGE, PLAIN]}
				comments={[]}
				restoredIds={new Set(["r1"])}
			/>,
		);
		const column = container.querySelector("[data-cds=ChatComposerQuotes]");
		const [reply, plain] = rows(container);
		if (reply === undefined || plain === undefined) throw new Error("no quote rows");
		const card = reply.querySelector("[data-cds=Card]");
		const media = reply.querySelector("[data-cds=CardMedia]");
		const quote = reply.querySelector("blockquote");
		expect(
			{
				column: classes(column),
				nextIsTiles: column?.nextElementSibling?.matches("ul[data-cds-composer-attachments-row]"),
				tiles: Array.from(container.querySelectorAll("ul[data-cds-composer-attachments-row] > li"), (tile) =>
					tile.getAttribute("data-chip-label"),
				),
				rows: [reply, plain].map(rowShape),
				root:
				{
					tabIndex: reply.getAttribute("tabindex"),
					kind: reply.getAttribute("data-cds"),
					attachment: reply.getAttribute("data-cds-attachment"),
					restored: [reply, plain].map((row) => row.getAttribute("data-cds-attachment-restored")),
					classes: classes(reply),
				},
				card: classes(card),
				fill: classes(card?.querySelector(".cds-card-fill") ?? null),
				media: classes(media),
				slot:
				{
					size: media?.firstElementChild?.getAttribute("data-size"),
					classes: classes(media?.firstElementChild ?? null),
				},
				link: classes(reply.querySelector("[data-cds=CardLink]")),
				quote:
				{
					classes: classes(quote),
					parts: Array.from(quote?.children ?? [], (part) => classes(part)),
				},
				remove: classes(reply.querySelector("button[data-cds-attachment-remove]")),
			},
		).toStrictEqual(
			{
				column: ["-mt-1", "-mx-1", "flex", "flex-col", "gap-xs", "mb-2", "min-w-0"],
				nextIsTiles: true,
				tiles: ["shot.png"],
				rows: [
					{
						name: REPLY_NAME,
						quote: "The build step runs vitest first and then the typecheck.",
						badge: "With reply",
						hint: "Swap these so the typecheck fails fast",
						describedBy: ["BLOCKQUOTE", "SPAN", "SPAN"],
						remove: `Remove ${REPLY_NAME}`,
					},
					{
						name: "Excerpt, Plain excerpt without a comment",
						quote: "Plain excerpt without a comment",
						badge: null,
						hint: null,
						describedBy: ["BLOCKQUOTE"],
						remove: "Remove Excerpt, Plain excerpt without a comment",
					},
				],
				root:
				{
					tabIndex: "-1",
					kind: "MessageAttachmentsQuote",
					attachment: "",
					restored: ["", null],
					classes: ["flex", "group/tile", "min-w-0", "outline-none", "w-full"],
				},
				card: [
					"after:absolute",
					"after:content-['']",
					"after:inset-0",
					"after:pointer-events-none",
					"after:rounded-[inherit]",
					"after:shadow-none",
					"flex",
					"flex-1",
					"flex-col",
					"group-focus-visible/tile:after:outline-hidden",
					"group-focus-visible/tile:after:shadow-focus",
					"group/card",
					"has-[[data-cds=CardLink]:focus-visible]:after:shadow-focus",
					"isolate",
					"min-w-0",
					"relative",
					"rounded-[calc(var(--radius-composer)-4px)]",
				],
				fill: [
					"-z-[1]",
					"absolute",
					"bg-fill-ghost-hover",
					"cds-card-fill",
					"group-hover/card:bg-neutral-hover",
					"inset-0",
					"m-0",
					"pointer-events-none",
					"rounded-[inherit]",
				],
				media: ["flex", "gap-xs", "items-center", "p-xs", "ps-sm"],
				slot:
				{
					size: "xs",
					classes: ["flex", "h-control", "items-center", "shrink-0", "text-ink-muted"],
				},
				link: [
					"after:absolute",
					"after:content-['']",
					"after:inset-0",
					"after:rounded-[calc(var(--radius-composer)-4px)]",
					"cursor-pointer",
					"outline-none",
				],
				quote:
				{
					classes: ["flex", "flex-1", "font-normal", "min-w-0", "text-body", "text-secondary"],
					parts: [
						["[quotes:auto]", "before:content-[open-quote]", "shrink-0"],
						["min-w-0", "truncate"],
						["[quotes:auto]", "before:content-[close-quote]", "shrink-0"],
					],
				},
				remove: [
					"aspect-square",
					"cursor-pointer",
					"focus-visible:shadow-focus",
					"focus-visible:text-primary",
					"h-control",
					"hover:bg-fill-ghost-hover",
					"hover:text-primary",
					"inline-flex",
					"items-center",
					"justify-center",
					"outline-none",
					"px-0",
					"rounded-[var(--cds-radius--xs)]",
					"shrink-0",
					"text-ink-muted",
					"w-control",
				],
			},
		);
	});

	it("renders a reply with a blank comment as a plain Excerpt row", () =>
	{
		const {container} = renderChips([
			{
				...REPLY,
				comment: "   ",
			},
		]);
		expect(rows(container).map(rowShape)).toStrictEqual([
			{
				name: "Excerpt, The build step runs vitest first and th…",
				quote: "The build step runs vitest first and then the typecheck.",
				badge: null,
				hint: null,
				describedBy: ["BLOCKQUOTE"],
				remove: "Remove Excerpt, The build step runs vitest first and th…",
			},
		]);
	});

	it("leaves out the tile row, and the column's bottom margin, when only rows are staged", () =>
	{
		const {container} = renderChips([REPLY, PLAIN]);
		expect(
			{
				tiles: container.querySelector("ul[data-cds-composer-attachments-row]"),
				column: classes(container.querySelector("[data-cds=ChatComposerQuotes]")),
				tray: classes(container.querySelector("[data-cds-composer-attachments]")),
			},
		).toStrictEqual(
			{
				tiles: null,
				column: ["-mt-1", "-mx-1", "flex", "flex-col", "gap-xs", "min-w-0"],
				tray: ["min-h-0", "min-w-0", "pb-0.5", "pt-1", "px-1"],
			},
		);
	});

	it("opens a read-only Reply preview of the quoted lines and the comment", async () =>
	{
		const {container} = renderChips([REPLY]);
		const link = container.querySelector<HTMLElement>("[data-cds=CardLink]");
		if (link === null) throw new Error("no reply CardLink");
		fireEvent.click(link);
		const dialog = await screen.findByRole("dialog");
		expect(
			{
				title: dialog.querySelector("h2")?.textContent,
				text: dialog.querySelector("blockquote")?.textContent,
				textboxes: dialog.querySelectorAll("textarea, input, [contenteditable=true]").length,
			},
		).toStrictEqual(
			{
				title: "Reply",
				text: "> The build step runs vitest first and then the typecheck.\n\nSwap these so the typecheck fails fast",
				textboxes: 0,
			},
		);
	});

	it("gives the With reply badge upstream's hinted row badge, its hint the comment's clipped first line", () =>
	{
		const {container} = renderChips([
			{
				...REPLY,
				comment: "First line of a long comment that also runs past forty characters easily\nand a second line",
			},
		]);
		const badge = container.querySelector<HTMLElement>("[data-cds=Badge]");
		if (badge === null) throw new Error("no With reply badge");
		const hint = document.getElementById(badge.getAttribute("aria-describedby") ?? "");
		fireEvent.focus(badge);
		expect(
			{
				role: badge.getAttribute("role"),
				size: badge.getAttribute("data-size"),
				tabIndex: badge.getAttribute("tabindex"),
				classes: classes(badge),
				anchor: classes(badge.parentElement),
				label: classes(badge.firstElementChild),
				hint: hint?.textContent,
				hidden: hint?.hidden,
				tooltip: screen.getByRole("tooltip").querySelector("span.min-w-0.break-words > bdi")?.textContent,
			},
		).toStrictEqual(
			{
				role: "img",
				size: "xs",
				tabIndex: "0",
				classes: [
					"align-middle",
					"bg-neutral",
					"focus-visible:shadow-focus",
					"font-medium",
					"font-sans",
					"gap-1",
					"h-control-nested",
					"inline-flex",
					"items-center",
					"leading-[round(1.25em,1px)]",
					"max-w-full",
					"min-w-0",
					"outline-none",
					"pointer-coarse:pointer-events-none",
					"pointer-events-auto",
					"px-sm",
					"rounded-chip",
					"text-caption",
					"text-secondary",
					"whitespace-nowrap",
				],
				anchor: ["inline-flex", "max-w-[40%]", "min-w-0", "relative", "shrink-0"],
				label: ["min-w-0", "overflow-x-clip", "pb-[0.05em]", "text-ellipsis", "whitespace-nowrap"],
				hint: "First line of a long comment that also …",
				hidden: true,
				tooltip: "First line of a long comment that also …",
			},
		);
	});

	describe("with a live strip", () =>
	{
		let stop: () => void = () =>
		{
		};
		const focusComposer = vi.fn<() => void>();

		function LiveChips()
		{
			return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
		}

		beforeEach(() =>
		{
			stop = registerComposer(
				SESSION,
				{
					insertText: () =>
					{
					},
					focus: focusComposer,
				},
			);
			attachContext(
				SESSION,
				{
					kind: "excerpt",
					text: REPLY.text,
					comment: REPLY.comment,
				},
			);
			attachContext(
				SESSION,
				{
					kind: "excerpt",
					text: PLAIN.text,
				},
			);
			focusComposer.mockClear();
		});

		afterEach(() =>
		{
			cleanup();
			takeContextChips(SESSION);
			stop();
		});

		function pressDelete(link: HTMLElement | undefined, key = "Backspace"): void
		{
			act(() =>
			{
				fireEvent.keyDown(
					link ?? document.body,
					{
						key,
					},
				);
				fireEvent.keyUp(
					window,
					{
						key,
					},
				);
			});
		}

		it("removes a focused row on Backspace, focusing the next row's CardLink, then the composer after the last", () =>
		{
			const {container} = render(<LiveChips />);
			const links = () => Array.from(container.querySelectorAll<HTMLElement>("[data-cds=CardLink]"));
			links()[0]?.focus();
			pressDelete(links()[0]);
			const afterFirst =
			{
				chips: getContextChips(SESSION).map(({text}) => text),
				focused: document.activeElement === links()[0],
				names: Array.from(
					container.querySelectorAll("[data-cds=CardLink] > .sr-only"),
					(name) => name.textContent,
				),
			};
			pressDelete(links()[0]);
			expect(
				{
					afterFirst,
					chips: getContextChips(SESSION).length,
					composerFocused: focusComposer.mock.calls.length,
				},
			).toStrictEqual(
				{
					afterFirst:
					{
						chips: [PLAIN.text],
						focused: true,
						names: ["Excerpt, Plain excerpt without a comment"],
					},
					chips: 0,
					composerFocused: 1,
				},
			);
		});
	});
});

describe("Saved draft pill", () =>
{
	const DRAFT: ContextChip =
	{
		id: "chip-draft",
		kind: "saved-draft",
		text: "x".repeat(39),
	};

	function pill(container: HTMLElement)
	{
		const root = container.querySelector<HTMLElement>("li[data-cds-attachment]");
		if (root === null) throw new Error("no saved draft pill");
		const body = root.querySelector<HTMLButtonElement>("button.epitaxy-pill-body");
		const remove = root.querySelector<HTMLButtonElement>("button.epitaxy-pill-remove");
		if (body === null || remove === null) throw new Error("no saved draft pill parts");
		return {
			root,
			body,
			remove,
		};
	}

	it("renders upstream's flat Note pill with its hover-revealed remove button", () =>
	{
		const {container} = render(
			<AttachedContextChips
				sessionId={SESSION}
				context={[DRAFT]}
				comments={[]}
				restoredIds={new Set(["chip-draft"])}
			/>,
		);
		const {root, body, remove} = pill(container);
		expect(
			{
				root: classes(root),
				restored: root.getAttribute("data-cds-attachment-restored"),
				body: classes(body),
				haspopup: body.getAttribute("aria-haspopup"),
				aria: body.getAttribute("aria-label"),
				icon: classes(body.firstElementChild),
				label: [classes(body.lastElementChild), body.lastElementChild?.textContent],
				remove: classes(remove),
				removeTabIndex: remove.tabIndex,
				removeAria: remove.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				root: ["focus-within:z-10", "group/pill", "hover:z-10", "relative", "shrink-0"],
				restored: "",
				body: [
					"bg-alpha-2",
					"border-0",
					"comfortable:px-3",
					"epitaxy-pill-body",
					"epitaxy-pill-body--flat",
					"focus-visible:outline-hidden",
					"focus-visible:shadow-focus",
					"gap-1.25",
					"h-10",
					"hide-focus-ring",
					"inline-flex",
					"items-center",
					"overflow-hidden",
					"px-2",
					"rounded-sm",
					"text-body",
					"text-muted-control",
					"text-secondary-control",
				],
				haspopup: "dialog",
				aria: "Saved draft · 39 characters",
				icon: ["flex", "items-center", "justify-center", "shrink-0"],
				label: [["max-w-[260px]", "truncate"], "Saved draft"],
				remove: [
					"-end-1.5",
					"-top-1.5",
					"absolute",
					"bg-surface-2",
					"epitaxy-pill-remove",
					"grid",
					"group-focus-within/pill:opacity-100",
					"group-focus-within/pill:pointer-events-auto",
					"group-hover/pill:opacity-100",
					"group-hover/pill:pointer-events-auto",
					"hover:text-primary",
					"motion-reduce:transition-none",
					"opacity-0",
					"place-items-center",
					"pointer-events-none",
					"ring-1",
					"ring-alpha-2",
					"rounded-full",
					"size-4",
					"text-secondary",
					"transition-opacity",
					"z-10",
				],
				removeTabIndex: -1,
				removeAria: "Remove Saved draft",
			},
		);
	});

	it("counts the characters in upstream's compact long notation", () =>
	{
		const {container} = renderChips([
			{
				...DRAFT,
				text: "x".repeat(1_000_072),
			},
			{
				...DRAFT,
				id: "chip-one",
				text: "x",
			},
		]);
		expect(
			[...container.querySelectorAll("button.epitaxy-pill-body")].map((body) => body.getAttribute("aria-label")),
		).toStrictEqual(["Saved draft · 1 million characters", "Saved draft · 1 character"]);
	});

	it("shows Saved draft over Click to edit. in its tooltip on keyboard focus", () =>
	{
		const {container} = renderChips([DRAFT]);
		fireEvent.focus(pill(container).body);
		const tip = screen.getByRole("tooltip");
		expect(
			{
				text: tip.textContent,
				detail: tip.lastElementChild?.textContent,
			},
		).toStrictEqual(
			{
				text: "Saved draftClick to edit.",
				detail: "Click to edit.",
			},
		);
	});

	it("lists Edit and Remove on right-click", async () =>
	{
		const {container} = renderChips([DRAFT]);
		fireEvent.contextMenu(
			pill(container).root,
			{
				clientX: 10,
				clientY: 10,
			},
		);
		const rows = await vi.waitFor(() =>
		{
			const menu = screen.getByRole("menu");
			return [...menu.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent);
		});
		expect(rows).toStrictEqual(["Edit", "Remove"]);
	});

	describe("removing the only copy", () =>
	{
		let stop: () => void = () =>
		{
		};
		const focusComposer = vi.fn<() => void>();

		function LiveChips()
		{
			return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
		}

		beforeEach(() =>
		{
			focusComposer.mockClear();
			stop = registerComposer(
				SESSION,
				{
					insertText: () =>
					{
					},
					focus: focusComposer,
				},
			);
			attachContext(
				SESSION,
				{
					kind: "saved-draft",
					text: "Erin's long draft",
				},
			);
			focusComposer.mockClear();
		});

		afterEach(() =>
		{
			cleanup();
			takeContextChips(SESSION);
			stop();
		});

		async function confirm()
		{
			const dialog = await screen.findByRole("alertdialog");
			await vi.waitFor(() =>
			{
				expect(document.activeElement?.textContent).toBe("Remove");
			});
			return {
				title: dialog.querySelector("h2")?.textContent,
				body: dialog.querySelector("p")?.textContent,
				buttons: [...dialog.querySelectorAll("button")].map((button) => button.textContent),
			};
		}

		const CONFIRM =
		{
			title: "Remove saved draft?",
			body: "This is the only copy of this text.",
			buttons: ["Cancel", "Remove"],
		};

		it("asks before × removes it, keeps it on Cancel and removes it on Remove, focusing the prompt", async () =>
		{
			const {container} = render(<LiveChips />);
			fireEvent.click(pill(container).remove);
			const asked = await confirm();
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Cancel",
					},
				),
			);
			const afterCancel = getContextChips(SESSION).length;
			fireEvent.click(pill(container).remove);
			await confirm();
			fireEvent.click(
				screen.getByRole(
					"button",
					{
						name: "Remove",
					},
				),
			);
			expect(
				{
					asked,
					afterCancel,
					after: getContextChips(SESSION).length,
					focusedPrompt: focusComposer.mock.calls.length > 0,
				},
			).toStrictEqual(
				{
					asked: CONFIRM,
					afterCancel: 1,
					after: 0,
					focusedPrompt: true,
				},
			);
		});

		it("asks before Delete or Backspace on the pill, and before menu Remove", async () =>
		{
			const {container} = render(<LiveChips />);
			const asks: unknown[] = [];
			for (const key of ["Delete", "Backspace"])
			{
				fireEvent.keyDown(
					pill(container).body,
					{
						key,
					},
				);
				asks.push(await confirm());
				fireEvent.click(
					screen.getByRole(
						"button",
						{
							name: "Cancel",
						},
					),
				);
				await vi.waitFor(() =>
				{
					expect(screen.queryByRole("alertdialog")).toBeNull();
				});
			}
			fireEvent.contextMenu(
				pill(container).root,
				{
					clientX: 10,
					clientY: 10,
				},
			);
			fireEvent.click(
				await screen.findByRole(
					"menuitem",
					{
						name: "Remove",
					},
				),
			);
			asks.push(await confirm());
			expect(asks).toStrictEqual([CONFIRM, CONFIRM, CONFIRM]);
		});
	});
});
