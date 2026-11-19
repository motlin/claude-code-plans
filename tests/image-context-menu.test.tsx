// @vitest-environment jsdom

import {act, cleanup, createEvent, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ImageContextMenu} from "../src/components/image-context-menu";
import {StepScreenshotStrip} from "../src/components/step-screenshot-strip";
import {ToastProvider} from "../src/components/toast";
import {TranscriptMessageMenu} from "../src/components/transcript-context-menu";
import {type AttachedImage, UserAttachments} from "../src/components/user-attachments";

const PNG = "data:image/png;base64,ZmFrZQ==";

const PASTED: AttachedImage =
{
	key: "pasted",
	src: PNG,
	label: "Attached image",
};

const REFERENCED: AttachedImage =
{
	key: "path:/tmp/fake/shot.png",
	src: "/api/image?path=%2Ftmp%2Ffake%2Fshot.png",
	label: "Referenced file /tmp/fake/shot.png",
	path: "/tmp/fake/shot.png",
};

class FakeClipboardItem
{
	constructor(readonly items: Record<string, Promise<Blob>>)
	{
	}
}

beforeEach(() =>
{
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1),
	);
	vi.stubGlobal("ClipboardItem", FakeClipboardItem);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(navigator, "clipboard");
});

/** Renders `children` inside a user turn's transcript menu, as session-chat does. */
function inUserTurn(children: ReactNode): void
{
	render(
		<ToastProvider>
			<TranscriptMessageMenu
				speaker="user"
				sessionId="test-session"
				uuid="user-1"
				markdown="Look at this"
				render={<div />}
			>
				{children}
			</TranscriptMessageMenu>
		</ToastProvider>,
	);
}

function rightClick(element: Element): boolean
{
	const event = createEvent.contextMenu(
		element,
		{
			clientX: 10,
			clientY: 10,
		},
	);
	fireEvent(element, event);
	return event.defaultPrevented;
}

/** Every open menu's rows top to bottom; "---" for separators. */
function openMenus():
{
	cds: string | null;
	rows: string[];
}[]
{
	return screen.queryAllByRole("menu").map((menu) => (
	{
		cds: menu.getAttribute("data-cds"),
		rows: [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((row) =>
			row.getAttribute("role") === "separator"
				? "---"
				: (row.querySelector("[data-menu-item-title]")?.textContent ?? row.textContent),
		),
	}));
}

function tile(index: number): Element
{
	const found = document.querySelectorAll("[data-attachment-tile] [role=button]")[index];
	if (found === undefined) throw new Error(`no tile ${index}`);
	return found;
}

function clickRow(title: string): void
{
	const row = screen.getAllByRole("menuitem").find((item) => item.textContent === title);
	if (row === undefined) throw new Error(`no row ${title}`);
	fireEvent.click(row);
}

const toasts = () => [...document.querySelectorAll("[data-toast-message]")].map((toast) => toast.textContent);

describe("image context menu (upstream c81abc216 `j`)", () =>
{
	it("opens Copy image · Save image on a pasted tile, instead of the user message menu", () =>
	{
		inUserTurn(<UserAttachments images={[PASTED]} sessionId="test-session" />);

		expect(
			{
				defaultPrevented: rightClick(tile(0)),
				menus: openMenus(),
				tabIndex: tile(0).getAttribute("tabindex"),
			},
		).toStrictEqual(
			{
				defaultPrevented: true,
				menus: [
					{
						cds: "ContextMenu",
						rows: ["Copy image", "Save image"],
					},
				],
				tabIndex: "0",
			},
		);
	});

	it("adds the file actions block for an image referenced by path", () =>
	{
		inUserTurn(<UserAttachments images={[REFERENCED]} sessionId="test-session" />);
		rightClick(tile(0));

		expect(openMenus()).toStrictEqual([
			{
				cds: "ContextMenu",
				rows: ["Copy image", "Save image", "---", "Attach as context", "Copy", "---", "Show in Finder"],
			},
		]);
	});

	it("saves a pasted image as image-<ms>.png through an <a download>", async () =>
	{
		vi.spyOn(Date, "now").mockReturnValue(1234);
		vi.stubGlobal(
			"URL",
			{
				...URL,
				createObjectURL: vi.fn<typeof URL.createObjectURL>(() => "blob:fake"),
				revokeObjectURL: vi.fn<typeof URL.revokeObjectURL>(),
			},
		);
		const downloads:
		{
			download: string;
			href: string;
		}[] = [];
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement)
		{
			downloads.push(
				{
					download: this.download,
					href: this.getAttribute("href") ?? "",
				},
			);
		});
		inUserTurn(<UserAttachments images={[PASTED]} />);
		rightClick(tile(0));
		clickRow("Save image");
		await act(async () =>
		{
			await Promise.resolve();
		});

		expect(
			{
				downloads,
				toasts: toasts(),
			},
		).toStrictEqual(
			{
				downloads: [
					{
						download: "image-1234.png",
						href: "blob:fake",
					},
				],
				toasts: [],
			},
		);
	});

	it("copies the image as PNG and toasts upstream's success or failure", async () =>
	{
		const write = vi.fn<(items: FakeClipboardItem[]) => Promise<void>>(async () => Promise.resolve());
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				configurable: true,
				value:
				{
					write,
				},
			},
		);
		inUserTurn(<UserAttachments images={[PASTED]} />);
		rightClick(tile(0));
		clickRow("Copy image");
		await act(async () =>
		{
			await Promise.resolve();
		});
		const copied = toasts();
		write.mockRejectedValueOnce(new Error("denied"));
		rightClick(tile(0));
		clickRow("Copy image");
		await act(async () =>
		{
			await Promise.resolve();
		});
		const blob = await write.mock.calls[0]?.[0][0]?.items["image/png"];

		expect(
			{
				types: write.mock.calls.map(([items]) => items.map((item) => Object.keys(item.items))),
				blobType: blob?.type,
				copied,
				failed: toasts(),
			},
		).toStrictEqual(
			{
				types: [[["image/png"]], [["image/png"]]],
				blobType: "image/png",
				copied: ["Image copied to clipboard."],
				failed: ["Couldn’t copy image.", "Image copied to clipboard."],
			},
		);
	});

	it("keeps both menus shut on a disabled image, leaving the browser menu", () =>
	{
		inUserTurn(
			<ImageContextMenu src={PNG} disabled>
				<span data-testid="pending">pending</span>
			</ImageContextMenu>,
		);

		expect(
			{
				defaultPrevented: rightClick(screen.getByTestId("pending")),
				menus: openMenus(),
			},
		).toStrictEqual(
			{
				defaultPrevented: false,
				menus: [],
			},
		);
	});

	it("opens the image menu, not the tool row's, on a screenshot thumbnail", () =>
	{
		inUserTurn(
			<StepScreenshotStrip
				shots={[
					{
						mimeType: "image/png",
						data: "ZmFrZQ==",
					},
				]}
				captions={[undefined]}
			/>,
		);
		const thumbnail = screen.getByRole(
			"button",
			{
				name: "Screenshot",
			},
		);
		rightClick(thumbnail);

		expect(
			{
				menus: openMenus(),
				tabIndex: thumbnail.getAttribute("tabindex"),
			},
		).toStrictEqual(
			{
				menus: [
					{
						cds: "ContextMenu",
						rows: ["Copy image", "Save image"],
					},
				],
				tabIndex: "0",
			},
		);
	});
});

describe("image viewer menus", () =>
{
	async function openViewer(): Promise<HTMLElement>
	{
		inUserTurn(<UserAttachments images={[PASTED, REFERENCED]} sessionId="test-session" />);
		fireEvent.click(tile(0));
		return screen.findByRole(
			"dialog",
			{
				name: "Image preview",
			},
		);
	}

	it("leaves a right-click on the viewer backdrop to the browser, with no transcript menu over it", async () =>
	{
		const viewer = await openViewer();

		expect(
			{
				defaultPrevented: rightClick(viewer),
				menus: openMenus(),
			},
		).toStrictEqual(
			{
				defaultPrevented: false,
				menus: [],
			},
		);
	});

	it("opens the image menu on the active slide image and the browser menu on a neighbour", async () =>
	{
		const viewer = await openViewer();
		const neighbour = viewer.querySelector("[data-viewer-slide][aria-hidden=true] img");
		if (neighbour === null) throw new Error("no neighbour slide");
		const neighbourPrevented = rightClick(neighbour);
		const neighbourMenus = openMenus();
		const active = viewer.querySelector("[data-viewer-slide]:not([aria-hidden=true]) img");
		if (active === null) throw new Error("no active slide");
		rightClick(active);

		expect(
			{
				neighbourPrevented,
				neighbourMenus,
				active: openMenus(),
			},
		).toStrictEqual(
			{
				neighbourPrevented: false,
				neighbourMenus: [],
				active: [
					{
						cds: "ContextMenu",
						rows: ["Copy image", "Save image"],
					},
				],
			},
		);
	});
});
