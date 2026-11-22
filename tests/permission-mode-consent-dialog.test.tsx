// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {PermissionModeConsentDialog} from "../src/components/permission-mode-consent-dialog";
import type {ConsentMode} from "../src/lib/permission-mode-consent";

const REGION_CLASS =
	"scroll-fade-y focus-visible:outline-hidden -mx-pad-xl -mb-pad-md flex min-h-9 flex-col overflow-y-auto px-xl pb-md scroll-fade-size-2 supports-[min-height:calc-size(auto,size)]:min-h-[calc-size(min-content,min(size,2.25rem))] focus-visible:shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fill-accent focus-visible:-outline-offset-2 focus-visible:scroll-fade-hide-top focus-visible:scroll-fade-hide-bottom";
const FOLDER_CLASS = "mt-3 flex min-h-[calc-size(min-content,min(size,2*var(--upstream-leading-code)))] flex-col";
const BOX_CLASS =
	"-mt-pad-sm rounded-t pt-sm has-[>:focus-visible]:shadow-focus has-[>:focus-visible]:outline-hidden flex min-h-0 flex-col -mx-pad-md bg-alpha-1 px-md -mb-pad-sm rounded-b pb-sm";
const PATH_CLASS =
	"scroll-fade-y focus-visible:outline-hidden font-mono-ui text-code text-primary break-all max-h-24 scroll-my-3 overflow-y-auto focus-visible:shadow-none focus-visible:scroll-fade-hide-top focus-visible:scroll-fade-hide-bottom";

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

function region(dialog: HTMLElement)
{
	return dialog.querySelector<HTMLElement>("[data-fixed-code-size]");
}

function pathBlock(dialog: HTMLElement)
{
	return dialog.querySelector<HTMLElement>("[data-fixed-code-size] [data-fixed-code-size]");
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
		const details = region(dialog);
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
				region:
				{
					className: details?.className,
					role: details?.getAttribute("role"),
					tabIndex: details?.getAttribute("tabindex"),
					label: details?.getAttribute("aria-label"),
					children: [...(details?.children ?? [])].map((child) => child.className),
				},
				folder: [...(path?.parentElement?.parentElement?.children ?? [])].map((child) => child.className),
				box: path?.parentElement?.className,
				path:
				{
					className: path?.className,
					title: path?.getAttribute("title"),
					dir: path?.getAttribute("dir"),
					role: path?.getAttribute("role"),
					tabIndex: path?.getAttribute("tabindex"),
					label: path?.getAttribute("aria-label"),
				},
				footnoteInRegion: link.parentElement?.parentElement === details,
				link: [
					link.className,
					link.getAttribute("data-inherit-color"),
					link.getAttribute("href"),
					link.getAttribute("target"),
					link.getAttribute("rel"),
				],
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
				region:
				{
					className: REGION_CLASS,
					role: null,
					tabIndex: null,
					label: null,
					children: [FOLDER_CLASS, "mt-3 text-footnote text-secondary"],
				},
				folder: [BOX_CLASS],
				box: BOX_CLASS,
				path:
				{
					className: PATH_CLASS,
					title: "/w",
					dir: "ltr",
					role: null,
					tabIndex: null,
					label: null,
				},
				footnoteInRegion: true,
				link: [
					"cds-reset text-link-inherit inline cursor-pointer",
					"",
					"https://code.claude.com/docs/en/security",
					"_blank",
					"noopener",
				],
				confirm:
				{
					danger: false,
					primary: true,
				},
				focused: "Cancel",
			},
		);
	});

	it("makes an overflowing region and path focusable groups that tab before the link, Cancel and confirm", async () =>
	{
		mockHeights(200, 96);
		renderDialog("auto", "/w");
		const dialog = await screen.findByRole("alertdialog");
		await waitFor(() =>
		{
			expect(pathBlock(dialog)?.getAttribute("role")).toBe("group");
		});
		const path = pathBlock(dialog);
		const details = region(dialog);
		const tabbables = [...dialog.querySelectorAll<HTMLElement>("a[href], button, [tabindex='0']")].map(
			(element) => element.getAttribute("aria-label") ?? element.firstChild?.textContent,
		);

		expect(
			{
				region: [
					details?.getAttribute("role"),
					details?.getAttribute("tabindex"),
					details?.getAttribute("aria-label"),
				],
				label: path?.getAttribute("aria-label"),
				tabIndex: path?.getAttribute("tabindex"),
				tabbables,
				text: dialog.textContent,
			},
		).toStrictEqual(
			{
				region: ["group", "0", "Workspace details"],
				label: "Workspace folder",
				tabIndex: "0",
				tabbables: ["Workspace details", "Workspace folder", "security guide", "Cancel", "Enable auto mode"],
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

	it("ignores a confirm in the first 600ms after each open, confirms after it, and declines on Cancel or Escape", async () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setTimeout", "clearTimeout"],
			},
		);
		restores.push(() =>
		{
			vi.useRealTimers();
		});
		const onConfirm = vi.fn<() => void>();
		const onCancel = vi.fn<() => void>();
		const pending = (mode: ConsentMode) => (
		{
			mode,
			asksEveryTime: false,
		});
		const dialog = (props: {pending: ReturnType<typeof pending> | null}) => (
			<PermissionModeConsentDialog
				pending={props.pending}
				workspace="/w"
				onConfirm={onConfirm}
				onCancel={onCancel}
			/>
		);
		const {rerender} = render(
			dialog(
				{
					pending: pending("auto"),
				},
			),
		);
		const confirmButton = (name: string) =>
			within(screen.getByRole("alertdialog")).getByRole(
				"button",
				{
					name,
				},
			);
		fireEvent.click(confirmButton("Enable auto mode"));
		const early = [onConfirm.mock.calls.length, screen.queryByRole("alertdialog") !== null];
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(600);
		});
		fireEvent.click(confirmButton("Enable auto mode"));
		const armed = onConfirm.mock.calls.length;
		rerender(
			dialog(
				{
					pending: null,
				},
			),
		);
		rerender(
			dialog(
				{
					pending: pending("bypassPermissions"),
				},
			),
		);
		fireEvent.click(confirmButton("Bypass permissions"));
		const rearmedEarly = onConfirm.mock.calls.length;
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(600);
		});
		fireEvent.click(confirmButton("Bypass permissions"));
		expect(
			{
				early,
				armed,
				rearmedEarly,
				rearmed: onConfirm.mock.calls.length,
				cancels: onCancel.mock.calls.length,
			},
		).toStrictEqual(
			{
				early: [0, true],
				armed: 1,
				rearmedEarly: 1,
				rearmed: 2,
				cancels: 0,
			},
		);
		cleanup();
		vi.useRealTimers();

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
			[cancelled, escaped].map(({onConfirm, onCancel}) => [
				onConfirm.mock.calls.length,
				onCancel.mock.calls.length,
			]),
		).toStrictEqual([
			[0, 1],
			[0, 1],
		]);
	});
});
