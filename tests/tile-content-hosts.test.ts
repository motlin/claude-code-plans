// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";

import {registerScrollSetter} from "../src/lib/scroll-setter";
import {TileContentHosts, siblingMovedAhead} from "../src/lib/tile-content-hosts";

/** jsdom has no `moveBefore`; this stand-in moves like `insertBefore`, as Chrome's state-preserving move does. */
function stubMoveBefore()
{
	Object.defineProperty(
		Element.prototype,
		"moveBefore",
		{
			configurable: true,
			value(this: Element, node: Node, child: Node | null)
			{
				this.insertBefore(node, child);
			},
		},
	);
}

function cell(): HTMLDivElement
{
	const element = document.createElement("div");
	document.body.append(element);
	return element;
}

/** A scroller inside `host` whose scroll extent jsdom (no layout) reports as given. */
function scroller(host: HTMLElement, scrollHeight = 1000, clientHeight = 200): HTMLDivElement
{
	const element = document.createElement("div");
	Object.defineProperty(
		element,
		"scrollHeight",
		{
			configurable: true,
			get: () => scrollHeight,
		},
	);
	Object.defineProperty(
		element,
		"clientHeight",
		{
			configurable: true,
			get: () => clientHeight,
		},
	);
	host.append(element);
	return element;
}

function scrollTo(element: HTMLElement, top: number)
{
	element.scrollTop = top;
	element.dispatchEvent(new Event("scroll"));
}

function pen(): HTMLElement | null
{
	return document.querySelector<HTMLElement>("[data-tile-host-pen]");
}

afterEach(() =>
{
	Reflect.deleteProperty(Element.prototype, "moveBefore");
	document.body.replaceChildren();
});

describe("TileContentHosts, as upstream's c9bc99274 registry", () =>
{
	it("owns one display:contents host per tile and moves it into the adopting cell", () =>
	{
		const hosts = new TileContentHosts(document);
		const host = hosts.host("files");
		const first = cell();
		const second = cell();
		hosts.adopt("files", first);
		const inFirst = host.parentNode === first;
		hosts.adopt("files", second);
		expect(
			{
				same: hosts.host("files") === host,
				attribute: host.getAttribute("data-tile-host"),
				style: host.getAttribute("style"),
				inFirst,
				inSecond: host.parentNode === second,
			},
		).toStrictEqual(
			{
				same: true,
				attribute: "files",
				style: "display:contents",
				inFirst: true,
				inSecond: true,
			},
		);
	});

	it("parks a released host in upstream's off-screen inert pen when moveBefore exists", () =>
	{
		stubMoveBefore();
		const hosts = new TileContentHosts(document);
		const host = hosts.host("files");
		const release = hosts.adopt(
			"files",
			cell(),
			{
				width: 300,
				height: 200,
			},
		);
		release();
		const parked = pen();
		const parkedCell = parked?.firstElementChild as HTMLElement | null;
		expect(
			{
				style: parked?.getAttribute("style"),
				inert: parked?.hasAttribute("inert"),
				inBody: parked?.parentNode === document.body,
				cells: parked?.childElementCount,
				cell: parkedCell &&
				{
					position: parkedCell.style.position,
					top: parkedCell.style.top,
					left: parkedCell.style.left,
					display: parkedCell.style.display,
					rows: parkedCell.style.gridTemplateRows,
					columns: parkedCell.style.gridTemplateColumns,
					width: parkedCell.style.width,
					height: parkedCell.style.height,
					contentVisibility: parkedCell.style.getPropertyValue("content-visibility"),
				},
				hostParked: host.parentNode === parkedCell,
			},
		).toStrictEqual(
			{
				style: "position:fixed;top:0;left:calc(100vw + 10000px);visibility:hidden;pointer-events:none;contain:layout",
				inert: true,
				inBody: true,
				cells: 1,
				cell:
				{
					position: "absolute",
					top: "0px",
					left: "0px",
					display: "grid",
					rows: "minmax(0px, 1fr)",
					columns: "minmax(0px, 1fr)",
					width: "300px",
					height: "200px",
					contentVisibility: "",
				},
				hostParked: true,
			},
		);

		const next = cell();
		hosts.adopt("files", next);
		const afterAdopt =
		{
			inNext: host.parentNode === next,
			cells: pen()?.childElementCount,
		};
		hosts.retain(new Set(["files"]));
		expect(
			{
				...afterAdopt,
				pen: pen(),
			},
		).toStrictEqual(
			{
				inNext: true,
				cells: 0,
				pen: null,
			},
		);
	});

	it("parks with display:none when the box is unknown, and content-visibility:hidden for a tile frozen out of the live set", () =>
	{
		stubMoveBefore();
		const hosts = new TileContentHosts(document);
		hosts.host("files");
		hosts.host("changes");
		const releaseFiles = hosts.adopt("files", cell());
		const releaseChanges = hosts.adopt(
			"changes",
			cell(),
			{
				width: 300,
				height: 200,
			},
		);
		hosts.freezeScrolls(new Set(["files"]));
		releaseFiles();
		releaseChanges();
		hosts.thawScrolls();
		const cells = [...(pen()?.children ?? [])].map((parked) =>
		{
			const style = (parked as HTMLElement).style;
			return {
				host: parked.firstElementChild?.getAttribute("data-tile-host"),
				display: style.display,
				contentVisibility: style.getPropertyValue("content-visibility"),
			};
		});
		expect(cells).toStrictEqual([
			{
				host: "files",
				display: "none",
				contentVisibility: "",
			},
			{
				host: "changes",
				display: "grid",
				contentVisibility: "hidden",
			},
		]);
	});

	it("never builds a pen without moveBefore, and retain disposes a closed tile's host", () =>
	{
		const hosts = new TileContentHosts(document);
		const host = hosts.host("files");
		const first = cell();
		hosts.adopt(
			"files",
			first,
			{
				width: 300,
				height: 200,
			},
		)();
		const penAfterRelease = pen();
		hosts.retain(new Set());
		expect(
			{
				pen: penAfterRelease,
				disposed: !host.isConnected,
				fresh: hosts.host("files") !== host,
			},
		).toStrictEqual(
			{
				pen: null,
				disposed: true,
				fresh: true,
			},
		);
	});

	it("removes parked hosts whose portal emptied on releaseParked, and the pen with them", () =>
	{
		stubMoveBefore();
		const hosts = new TileContentHosts(document);
		hosts.host("files").append(document.createElement("p"));
		hosts.host("changes");
		hosts.adopt(
			"files",
			cell(),
			{
				width: 300,
				height: 200,
			},
		)();
		hosts.adopt(
			"changes",
			cell(),
			{
				width: 300,
				height: 200,
			},
		)();
		hosts.releaseParked();
		const kept = [...(pen()?.querySelectorAll("[data-tile-host]") ?? [])].map((host) =>
			host.getAttribute("data-tile-host"),
		);
		hosts.host("files").replaceChildren();
		hosts.releaseParked();
		expect(
			{
				kept,
				pen: pen(),
			},
		).toStrictEqual(
			{
				kept: ["files"],
				pen: null,
			},
		);
	});
});

describe("TileContentHosts scroll memory, as upstream's v / A / j", () =>
{
	it("restores a scroller's offset that a move reset to 0", () =>
	{
		const hosts = new TileContentHosts(document);
		const body = scroller(hosts.host("files"));
		const release = hosts.adopt("files", cell());
		scrollTo(body, 120);
		body.scrollLeft = 40;
		release();
		body.scrollTop = 0;
		body.scrollLeft = 0;
		hosts.adopt("files", cell());
		expect(
			{
				top: body.scrollTop,
				left: body.scrollLeft,
			},
		).toStrictEqual(
			{
				top: 120,
				left: 40,
			},
		);
	});

	it("pins a scroller that sat at the bottom to its new bottom", () =>
	{
		const hosts = new TileContentHosts(document);
		let height = 1000;
		const body = scroller(hosts.host("chat"));
		Object.defineProperty(
			body,
			"scrollHeight",
			{
				configurable: true,
				get: () => height,
			},
		);
		const release = hosts.adopt("chat", cell());
		scrollTo(body, 799);
		release();
		height = 1500;
		body.scrollTop = 0;
		hosts.adopt("chat", cell());
		expect(body.scrollTop).toBe(1300);
	});

	it("remembers at most 32 scrolled elements, dropping the oldest", () =>
	{
		const hosts = new TileContentHosts(document);
		const host = hosts.host("files");
		const scrollers = Array.from(
			{
				length: 33,
			},
			() => scroller(host),
		);
		const release = hosts.adopt("files", cell());
		for (const element of scrollers) scrollTo(element, 50);
		release();
		for (const element of scrollers) element.scrollTop = 0;
		hosts.adopt("files", cell());
		expect(
			{
				first: scrollers[0]?.scrollTop,
				rest: scrollers.slice(1).every((element) => element.scrollTop === 50),
			},
		).toStrictEqual(
			{
				first: 0,
				rest: true,
			},
		);
	});

	it("restores the offsets frozen before a structural change, not the ones read after it", () =>
	{
		const hosts = new TileContentHosts(document);
		const body = scroller(hosts.host("files"));
		const release = hosts.adopt("files", cell());
		scrollTo(body, 120);
		hosts.freezeScrolls(new Set(["files"]));
		body.scrollTop = 0;
		release();
		hosts.thawScrolls();
		hosts.adopt("files", cell());
		expect(body.scrollTop).toBe(120);
	});

	it("snapshots before an in-place slot move and restores after it (slotWillMove / slotMoved)", () =>
	{
		const hosts = new TileContentHosts(document);
		const body = scroller(hosts.host("files"));
		const slot = cell();
		hosts.adopt("files", slot);
		scrollTo(body, 120);
		hosts.slotWillMove("files", slot);
		body.scrollTop = 0;
		hosts.slotMoved("files", slot);
		expect(body.scrollTop).toBe(120);
	});

	it("writes restored offsets through a scroller's registered setter (upstream gT), plain scrollTop otherwise", () =>
	{
		const hosts = new TileContentHosts(document);
		const host = hosts.host("chat");
		const owned = scroller(host);
		const plain = scroller(host);
		const writes: number[] = [];
		const unregister = registerScrollSetter(owned, (top) =>
		{
			writes.push(top);
		});
		const release = hosts.adopt("chat", cell());
		scrollTo(owned, 120);
		scrollTo(plain, 90);
		release();
		owned.scrollTop = 0;
		plain.scrollTop = 0;
		hosts.adopt("chat", cell());
		unregister();
		const releaseAgain = hosts.adopt("chat", cell());
		scrollTo(owned, 60);
		releaseAgain();
		owned.scrollTop = 0;
		hosts.adopt("chat", cell());
		expect(
			{
				writes,
				owned: owned.scrollTop,
				plain: plain.scrollTop,
			},
		).toStrictEqual(
			{
				writes: [120],
				owned: 60,
				plain: 90,
			},
		);
	});
});

describe("in-place slot moves, as upstream's wt orderKey effect and yt", () =>
{
	it("parks an iframe host before a move only when a sibling moves ahead of the tile", () =>
	{
		stubMoveBefore();
		const hosts = new TileContentHosts(document);
		const host = hosts.host("preview");
		host.append(document.createElement("iframe"));
		const slot = cell();
		hosts.adopt("preview", slot);
		hosts.slotWillMove("preview", slot, false);
		const keptInPlace = host.parentNode === slot;
		hosts.slotWillMove("preview", slot, true);
		expect(
			{
				keptInPlace,
				parked: pen()?.contains(host),
			},
		).toStrictEqual(
			{
				keptInPlace: true,
				parked: true,
			},
		);
	});

	it("derives the sibling-ahead test from the old order and ahead keys and the new ahead key", () =>
	{
		expect(
			{
				unchanged: siblingMovedAhead("/chat,files", "/chat", "/chat"),
				siblingNowAhead: siblingMovedAhead("/files,chat", "/", "/files"),
				siblingNoLongerAhead: siblingMovedAhead("/chat,files", "/chat", "/"),
				deeper: siblingMovedAhead("/chat,files", "/chat", "/chat/changes"),
			},
		).toStrictEqual(
			{
				unchanged: false,
				siblingNowAhead: true,
				siblingNoLongerAhead: false,
				deeper: true,
			},
		);
	});
});

describe("TileContentHosts focus and caret restore, as upstream's D / O / M", () =>
{
	it("refocuses the element that held focus and reapplies its selection when focus fell to the body", () =>
	{
		const hosts = new TileContentHosts(document);
		const editor = document.createElement("div");
		editor.tabIndex = 0;
		editor.textContent = "hello world";
		hosts.host("chat").append(editor);
		const release = hosts.adopt("chat", cell());
		editor.focus();
		// Chrome leaves the selection alone when it focuses a non-editable element; jsdom collapses it into the element.
		const nativeFocus = editor.focus.bind(editor);
		editor.focus = (options) =>
		{
			nativeFocus(options);
			document.getSelection()?.removeAllRanges();
		};
		const text = editor.firstChild!;
		document.getSelection()?.setBaseAndExtent(text, 2, text, 4);
		release();
		editor.blur();
		document.getSelection()?.removeAllRanges();
		hosts.adopt("chat", cell());
		const selection = document.getSelection();
		expect(
			{
				focused: document.activeElement === editor,
				anchor: selection?.anchorNode === text ? selection.anchorOffset : null,
				focus: selection?.focusNode === text ? selection.focusOffset : null,
			},
		).toStrictEqual(
			{
				focused: true,
				anchor: 2,
				focus: 4,
			},
		);
	});

	it("leaves focus alone when it moved elsewhere in the meantime", () =>
	{
		const hosts = new TileContentHosts(document);
		const input = document.createElement("input");
		hosts.host("chat").append(input);
		const other = document.createElement("button");
		document.body.append(other);
		const release = hosts.adopt("chat", cell());
		input.focus();
		release();
		other.focus();
		hosts.adopt("chat", cell());
		expect(document.activeElement).toBe(other);
	});
});

describe("TileContentHosts focus targets, as upstream's x / S / C / T", () =>
{
	function adopted(hosts: TileContentHosts, id: string, html: string): HTMLDivElement
	{
		const host = hosts.host(id);
		host.innerHTML = html;
		hosts.adopt(id, cell());
		return host;
	}

	it("skips the drag handle, focus-pass, negative-tabindex and disabled controls for the marked target", () =>
	{
		const hosts = new TileContentHosts(document);
		const host = adopted(
			hosts,
			"chat",
			`<button class="tiles-drag-handle">Move</button>
			<span data-tile-focus-pass><button>New tab</button></span>
			<button tabindex="-1">Roving</button>
			<button disabled>Disabled</button>
			<textarea aria-label="Prompt" data-tile-focus-target></textarea>`,
		);
		expect(
			{
				focused: hosts.focusTile("chat"),
				active: document.activeElement === host.querySelector("textarea"),
				hasTarget: hosts.hasFocusTarget("chat"),
			},
		).toStrictEqual(
			{
				focused: true,
				active: true,
				hasTarget: true,
			},
		);
	});

	it("focuses the first eligible control inside a marked target that is not focusable itself", () =>
	{
		const hosts = new TileContentHosts(document);
		const host = adopted(
			hosts,
			"terminal",
			`<div data-tile-focus-target><button tabindex="-1">Tab</button><button>Panel</button></div>`,
		);
		hosts.focusTile("terminal");
		expect(document.activeElement?.textContent).toBe("Panel");
		expect(host.isConnected).toBe(true);
	});

	it("skips a marked target inside a pane miniature and falls back to the first eligible focusable", () =>
	{
		const hosts = new TileContentHosts(document);
		adopted(
			hosts,
			"files",
			`<button class="tiles-drag-handle">Move</button><button>Show files</button>
			<div data-pane-miniature><textarea data-tile-focus-target></textarea></div>`,
		);
		expect(
			{
				hasTarget: hosts.hasFocusTarget("files"),
				focused: hosts.focusTile("files"),
			},
		).toStrictEqual(
			{
				hasTarget: false,
				focused: true,
			},
		);
		expect(document.activeElement?.textContent).toBe("Show files");
	});

	it("focuses the host's cell at tabindex -1 when nothing inside is focusable, and reports the tile as interacted", () =>
	{
		const hosts = new TileContentHosts(document);
		const interacted: string[] = [];
		hosts.setInteractHandler((id) => interacted.push(id));
		const host = adopted(hosts, "changes", "<p>No changes</p>");
		const focused = hosts.focusTile("changes");
		expect(
			{
				focused,
				active: document.activeElement === host.parentElement,
				tabindex: host.parentElement?.getAttribute("tabindex"),
				interacted,
			},
		).toStrictEqual(
			{
				focused: true,
				active: true,
				tabindex: "-1",
				interacted: ["changes"],
			},
		);
	});

	it("routes focusin and pointerdown inside a host to the interact handler and remembers the last focused tile", () =>
	{
		const hosts = new TileContentHosts(document);
		const interacted: string[] = [];
		const chat = adopted(hosts, "chat", "<textarea></textarea>");
		const files = adopted(hosts, "files", "<button>Show files</button>");
		chat.querySelector("textarea")?.focus();
		hosts.setInteractHandler((id) => interacted.push(id));
		files.querySelector("button")?.dispatchEvent(
			new Event(
				"pointerdown",
				{
					bubbles: true,
				},
			),
		);
		files.querySelector("button")?.focus();
		files.querySelector("button")?.blur();
		expect(
			{
				interacted,
				tileOf: hosts.tileOf(files.querySelector("button")),
				holdsFiles: hosts.holdsFocus("files"),
				holdsChat: hosts.holdsFocus("chat"),
			},
		).toStrictEqual(
			{
				// A handler set while focus sits in a tile reports that tile at once (upstream setInteractHandler).
				interacted: ["chat", "files", "files"],
				tileOf: "files",
				holdsFiles: true,
				holdsChat: false,
			},
		);
	});

	it("retain returns the closed tile only when it held focus and focus fell to the body", () =>
	{
		const hosts = new TileContentHosts(document);
		const files = adopted(hosts, "files", "<button>Show files</button>");
		adopted(hosts, "changes", "<button>Show changes</button>");
		const other = document.createElement("button");
		document.body.append(other);
		files.querySelector("button")?.focus();
		const releaseFiles = hosts.adopt("files", files.parentElement!);
		releaseFiles();
		files.parentElement?.remove();
		const closedFocused = hosts.retain(new Set(["changes"]));
		const changes = hosts.host("changes");
		changes.querySelector("button")?.focus();
		hosts.adopt("changes", changes.parentElement!)();
		other.focus();
		expect(
			{
				closedFocused,
				focusElsewhere: hosts.retain(new Set()),
			},
		).toStrictEqual(
			{
				closedFocused: "files",
				focusElsewhere: null,
			},
		);
	});
});
