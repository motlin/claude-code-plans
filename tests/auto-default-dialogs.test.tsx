// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {AutoDefaultOfferDialogs} from "../src/components/home/auto-default-dialogs";
import {ToastProvider} from "../src/components/toast";
import {cdsButtonClass} from "../src/components/ui/cds-button";
import type {AutoDefaultOffer, AutoDefaultOfferBody} from "../src/lib/api/auto-default-offer";
import {composerDefaultsQueryOptions} from "../src/lib/api/composer-defaults";

const BODY =
	"Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.";
const OFF: AutoDefaultOffer =
{
	noticeEligible: false,
	nudgeMode: null,
};
const NOTICE: AutoDefaultOffer =
{
	noticeEligible: true,
	nudgeMode: null,
};

let visibility: DocumentVisibilityState = "visible";

beforeEach(() =>
{
	visibility = "visible";
	vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

function setup({
	offer,
	folderChoice,
	repoDefaultMode = null,
	post = async () => Promise.resolve(OFF),
}: {
	offer: AutoDefaultOffer | undefined;
	folderChoice?: string;
	repoDefaultMode?: string | null;
	post?: (body: AutoDefaultOfferBody) => Promise<AutoDefaultOffer>;
})
{
	const queryClient = new QueryClient();
	queryClient.setQueryData(
		composerDefaultsQueryOptions.queryKey,
		{
			model: null,
			effortLevel: null,
			defaultMode: offer?.nudgeMode ?? null,
			defaultModeManaged: false,
			repoDefaultMode: null,
			modelManaged: false,
			availableModels: null,
			bypassPermissionsAllowed: false,
			fastMode: false,
			fastModeBlocked: null,
			cliFallbackMode: "default",
		},
	);
	const postSpy = vi.fn<(body: AutoDefaultOfferBody) => Promise<AutoDefaultOffer>>(post);
	const view = (next: AutoDefaultOffer | undefined) => (
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<AutoDefaultOfferDialogs
					offer={next}
					folderChoice={folderChoice}
					repoDefaultMode={repoDefaultMode}
					post={postSpy}
				/>
			</ToastProvider>
		</QueryClientProvider>
	);
	const result = render(view(offer));
	return {
		queryClient,
		post: postSpy,
		rerender: (next: AutoDefaultOffer | undefined) =>
		{
			result.rerender(view(next));
		},
	};
}

function dialogShape(dialog: HTMLElement)
{
	const body = dialog.firstElementChild;
	const stack = body?.firstElementChild;
	const footer = body?.lastElementChild;
	const link = dialog.querySelector("a");
	return {
		role: dialog.getAttribute("role"),
		cds: dialog.getAttribute("data-cds"),
		popupWidth: dialog.className.includes("max-w-[28rem]") && dialog.className.includes("epitaxy-root"),
		popupSurface: ["rounded-dialog", "bg-surface-popover", "rounded-card", "bg-surface-3"].filter((token) =>
			dialog.className.split(/\s+/).includes(token),
		),
		stackClass: stack?.className,
		stack: [...(stack?.children ?? [])].map((child) => (
		{
			tag: child.tagName,
			className: child.className,
			text: child.textContent,
		})),
		link:
		{
			href: link?.getAttribute("href"),
			target: link?.getAttribute("target"),
			rel: link?.getAttribute("rel"),
		},
		footerClass: footer?.className,
		footer: [...(footer?.children ?? [])].map((child) => (
		{
			tag: child.tagName,
			className: child.className,
			buttons:
				child.tagName === "BUTTON"
					? []
					: [...child.querySelectorAll("button")].map((button) => button.textContent),
			text: child.textContent,
		})),
	};
}

const TITLE_CLASS = "text-[15px] leading-5 font-[520] break-words text-primary";
const DESCRIPTION_CLASS = "mt-0 text-body font-normal break-words text-secondary";
const FOOTNOTE_CLASS = "text-footnote text-muted-as-secondary";

describe("AutoDefaultOfferDialogs: the notice", () =>
{
	it("ports upstream's qge: copy, structure, Got it focused, marked seen once when first shown", async () =>
	{
		const {post} = setup(
			{
				offer: NOTICE,
			},
		);
		const dialog = await screen.findByRole("alertdialog");
		await waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Got it");
		});
		expect(
			{
				shape: dialogShape(dialog),
				posts: post.mock.calls,
			},
		).toStrictEqual(
			{
				shape:
				{
					role: "alertdialog",
					cds: "Dialog",
					popupWidth: true,
					popupSurface: ["rounded-dialog", "bg-surface-popover"],
					stackClass: "flex flex-col gap-3",
					stack: [
						{
							tag: "H2",
							className: TITLE_CLASS,
							text: "Auto mode is now Claude Code’s default permission mode",
						},
						{
							tag: "P",
							className: DESCRIPTION_CLASS,
							text: BODY,
						},
						{
							tag: "P",
							className: FOOTNOTE_CLASS,
							text: "Learn more about permission modes(opens in new tab).",
						},
					],
					link:
					{
						href: "https://code.claude.com/docs/en/permission-modes",
						target: "_blank",
						rel: "noopener",
					},
					footerClass: "mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
					footer: [
						{
							tag: "BUTTON",
							className: cdsButtonClass("primary"),
							buttons: [],
							text: "Got it",
						},
					],
				},
				posts: [
					[
						{
							surface: "notice",
						},
					],
				],
			},
		);

		fireEvent.keyDown(
			dialog,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});
		expect(post.mock.calls.length).toBe(1);
	});

	it("waits for the tab to be visible before marking it seen", async () =>
	{
		visibility = "hidden";
		const {post} = setup(
			{
				offer: NOTICE,
			},
		);
		await screen.findByRole("alertdialog");
		const whileHidden = post.mock.calls.length;
		visibility = "visible";
		act(() =>
		{
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(
			{
				whileHidden,
				after: post.mock.calls,
			},
		).toStrictEqual(
			{
				whileHidden: 0,
				after: [
					[
						{
							surface: "notice",
						},
					],
				],
			},
		);
	});

	it("latches its decision: waits for the offer, then a refetch can't close it", async () =>
	{
		const {rerender} = setup(
			{
				offer: undefined,
			},
		);
		const beforeSettled = screen.queryByRole("alertdialog");
		rerender(NOTICE);
		await screen.findByRole("alertdialog");
		rerender(OFF);
		expect(
			{
				beforeSettled,
				stillOpen: screen.queryByRole("alertdialog") !== null,
			},
		).toStrictEqual(
			{
				beforeSettled: null,
				stillOpen: true,
			},
		);
	});

	it("shows nothing when ineligible, when the folder remembers a mode, or when the project sets one", () =>
	{
		setup(
			{
				offer: OFF,
			},
		);
		cleanup();
		setup(
			{
				offer: NOTICE,
				folderChoice: "acceptEdits",
			},
		);
		cleanup();
		setup(
			{
				offer: NOTICE,
				repoDefaultMode: "plan",
			},
		);
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});
});

describe("AutoDefaultOfferDialogs: the nudge", () =>
{
	it("ports upstream's q: Keep {mode} (focused) then Switch to auto, footer justify-between, nothing posted on show", async () =>
	{
		const {post} = setup(
			{
				offer:
				{
					noticeEligible: false,
					nudgeMode: "plan",
				},
			},
		);
		const dialog = await screen.findByRole("alertdialog");
		await waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Keep Plan");
		});
		const shape = dialogShape(dialog);
		expect(
			{
				popupSurface: shape.popupSurface,
				title: shape.stack[0],
				footerClass: shape.footerClass,
				footer: shape.footer,
				posts: post.mock.calls,
			},
		).toStrictEqual(
			{
				popupSurface: ["rounded-dialog", "bg-surface-popover"],
				title:
				{
					tag: "H2",
					className: TITLE_CLASS,
					text: "Make auto mode your default permission mode?",
				},
				footerClass: "mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between",
				footer: [
					{
						tag: "DIV",
						className: "flex items-center gap-3",
						buttons: ["Keep Plan"],
						text: "Keep Plan",
					},
					{
						tag: "DIV",
						className: "flex items-center gap-3",
						buttons: ["Switch to auto"],
						text: "Switch to auto",
					},
				],
				posts: [],
			},
		);
	});

	it("Switch to auto posts accept and makes Auto the draft's default", async () =>
	{
		const {post, queryClient} = setup(
			{
				offer:
				{
					noticeEligible: false,
					nudgeMode: "acceptEdits",
				},
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "Switch to auto",
				},
			),
		);
		await waitFor(() =>
		{
			expect(queryClient.getQueryData(composerDefaultsQueryOptions.queryKey)?.defaultMode).toBe("auto");
		});
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});
		expect(post.mock.calls).toStrictEqual([
			[
				{
					surface: "nudge",
					choice: "accept",
				},
			],
		]);
	});

	it("Escape declines and leaves the mode", async () =>
	{
		const {post, queryClient} = setup(
			{
				offer:
				{
					noticeEligible: false,
					nudgeMode: "default",
				},
			},
		);
		fireEvent.keyDown(
			await screen.findByRole("alertdialog"),
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(post.mock.calls).toStrictEqual([
				[
					{
						surface: "nudge",
						choice: "decline",
					},
				],
			]);
		});
		expect(queryClient.getQueryData(composerDefaultsQueryOptions.queryKey)?.defaultMode).toBe("default");
	});

	it("a failed accept shows a toast and keeps the mode", async () =>
	{
		const {queryClient} = setup(
			{
				offer:
				{
					noticeEligible: false,
					nudgeMode: "plan",
				},
				post: async () => Promise.reject(new Error("409")),
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: "Switch to auto",
				},
			),
		);
		await screen.findByText("Couldn’t update your default permission mode");
		expect(queryClient.getQueryData(composerDefaultsQueryOptions.queryKey)?.defaultMode).toBe("plan");
	});
});
