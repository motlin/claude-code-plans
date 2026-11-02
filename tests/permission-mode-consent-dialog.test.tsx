// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {PermissionModeConsentDialog} from "../src/components/permission-mode-consent-dialog";
import type {ConsentMode} from "../src/lib/permission-mode-consent";

const PATH_CLASS =
	"scroll-fade-y focus-visible:outline-hidden mt-3 max-h-24 overflow-y-auto font-mono-ui text-code text-primary break-all focus-visible:shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fill-accent focus-visible:-outline-offset-2 focus-visible:scroll-fade-hide-top focus-visible:scroll-fade-hide-bottom";

const restores: (() => void)[] = [];

afterEach(() =>
{
	cleanup();
	for (const restore of restores.splice(0)) restore();
});

/** jsdom has no layout: give every element this scroll and client height. */
function mockHeights(scrollHeight: number, clientHeight: number)
{
	const scroll = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
	const client = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
	restores.push(() =>
	{
		scroll.mockRestore();
		client.mockRestore();
	});
}

function renderDialog(mode: ConsentMode, workspace: string)
{
	const onConfirm = vi.fn<() => void>();
	const onCancel = vi.fn<() => void>();
	render(
		<PermissionModeConsentDialog
			pending={
			{
				mode,
				asksEveryTime: false,
			}}
			workspace={workspace}
			onConfirm={onConfirm}
			onCancel={onCancel}
		/>,
	);
	return {
		onConfirm,
		onCancel,
	};
}

function pathBlock(dialog: HTMLElement)
{
	return dialog.querySelector<HTMLElement>("[data-fixed-code-size]");
}

describe("PermissionModeConsentDialog", () =>
{
	it("draws upstream's Bypass dialog with the workspace folder, footnote and a primary confirm", async () =>
	{
		mockHeights(20, 96);
		renderDialog("bypassPermissions", "/w");
		const dialog = await screen.findByRole("alertdialog");
		await waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Cancel");
		});
		const path = pathBlock(dialog);
		const confirm = within(dialog).getByRole(
			"button",
			{
				name: "Bypass permissions",
			},
		);
		const link = within(dialog).getByRole(
			"link",
			{
				name: "security guide",
			},
		);

		expect(
			{
				text: dialog.textContent,
				path:
				{
					className: path?.className,
					title: path?.getAttribute("title"),
					dir: path?.getAttribute("dir"),
					role: path?.getAttribute("role"),
					tabIndex: path?.getAttribute("tabindex"),
					label: path?.getAttribute("aria-label"),
				},
				footnote: link.parentElement?.className,
				link: [link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")],
				confirm:
				{
					danger: confirm.className.includes("menu-danger"),
					primary: confirm.className.includes("bg-fill-primary"),
				},
				focused: document.activeElement?.textContent,
			},
		).toStrictEqual(
			{
				text: "Bypass all permissions?Claude will read, edit, and execute files without asking — including potentially destructive commands. Only use this in isolated or disposable environments./wYou won’t be asked again for this workspace. Read our security guide(opens in new tab) for details.CancelBypass permissions",
				path:
				{
					className: PATH_CLASS,
					title: "/w",
					dir: "ltr",
					role: null,
					tabIndex: null,
					label: null,
				},
				footnote: "mt-3 text-footnote text-muted-as-secondary",
				link: ["https://code.claude.com/docs/en/security", "_blank", "noopener"],
				confirm:
				{
					danger: false,
					primary: true,
				},
				focused: "Cancel",
			},
		);
	});

	it("makes an overflowing path a focusable group that tabs before the link, Cancel and confirm", async () =>
	{
		mockHeights(200, 96);
		renderDialog("auto", "/w");
		const dialog = await screen.findByRole("alertdialog");
		await waitFor(() =>
		{
			expect(pathBlock(dialog)?.getAttribute("role")).toBe("group");
		});
		const path = pathBlock(dialog);
		const tabbables = [...dialog.querySelectorAll<HTMLElement>("a[href], button, [tabindex='0']")].map(
			(element) => element.getAttribute("aria-label") ?? element.firstChild?.textContent,
		);

		expect(
			{
				label: path?.getAttribute("aria-label"),
				tabIndex: path?.getAttribute("tabindex"),
				tabbables,
				text: dialog.textContent,
			},
		).toStrictEqual(
			{
				label: "Workspace folder",
				tabIndex: "0",
				tabbables: ["Workspace folder", "security guide", "Cancel", "Enable auto mode"],
				text: "Enable auto mode?Claude will decide which actions are safe to run without asking. Longer tasks run uninterrupted, with extra safeguards against prompt injection./wYou won’t be asked again. Read our security guide(opens in new tab) for details.CancelEnable auto mode",
			},
		);
	});

	it("isolates RTL runs and shows control characters in the path", async () =>
	{
		renderDialog("bypassPermissions", "/Users/a/مشروع/app\u0007x");
		const path = pathBlock(await screen.findByRole("alertdialog"));
		expect(
			{
				html: path?.innerHTML,
				title: path?.getAttribute("title"),
			},
		).toStrictEqual(
			{
				html: '/Users/a/<bdi dir="rtl">مشروع</bdi>/app[U+0007]x',
				title: "/Users/a/⁧مشروع⁩/app[U+0007]x",
			},
		);
	});

	it("drops the path block with no workspace and points only at the security guide", async () =>
	{
		renderDialog("bypassPermissions", "");
		const dialog = await screen.findByRole("alertdialog");
		expect(
			{
				path: pathBlock(dialog),
				text: dialog.textContent,
			},
		).toStrictEqual(
			{
				path: null,
				text: "Bypass all permissions?Claude will read, edit, and execute files without asking — including potentially destructive commands. Only use this in isolated or disposable environments.Read our security guide(opens in new tab) for details.CancelBypass permissions",
			},
		);
	});

	it("confirms on the confirm button and declines on Cancel or Escape", async () =>
	{
		const confirmed = renderDialog("auto", "/w");
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole(
				"button",
				{
					name: "Enable auto mode",
				},
			),
		);
		cleanup();
		const cancelled = renderDialog("auto", "/w");
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		cleanup();
		const escaped = renderDialog("auto", "/w");
		fireEvent.keyDown(
			await screen.findByRole("alertdialog"),
			{
				key: "Escape",
			},
		);

		expect(
			[confirmed, cancelled, escaped].map(({onConfirm, onCancel}) => [
				onConfirm.mock.calls.length,
				onCancel.mock.calls.length,
			]),
		).toStrictEqual([
			[1, 0],
			[0, 1],
			[0, 1],
		]);
	});
});
