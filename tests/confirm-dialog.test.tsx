// @vitest-environment jsdom

import {Dialog} from "@base-ui/react/dialog";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ConfirmDialog} from "../src/components/confirm-dialog";
import {cdsButtonClass} from "../src/components/ui/cds-button";
import {PanelsOff} from "./fizzy-lake-off";

afterEach(cleanup);

function dialog()
{
	return (
		<ConfirmDialog
			open
			onOpenChange={() =>
			{
			}}
			title="Delete session?"
			body="This can't be undone."
			confirmLabel="Delete"
			onConfirm={() =>
			{
			}}
		/>
	);
}

async function anatomy()
{
	const popup = await screen.findByRole("alertdialog");
	const title = screen.getByText("Delete session?");
	const description = screen.getByText("This can't be undone.");
	const band = title.parentElement;
	return {
		cds: popup.getAttribute("data-cds"),
		fizzy: popup.getAttribute("data-cds-fizzy"),
		popupPad: popup.className.split(" ").filter((name) => /^p-\d$|^\[--cds-pad-xl:/.test(name)),
		surface: popup.className.split(" ").filter((name) => /^rounded-|^bg-surface/.test(name)),
		body: title.parentElement === popup ? "popup" : (popup.firstElementChild?.className ?? null),
		band:
			band?.getAttribute("data-cds-part") === "band"
				?
					{
						alert: band.getAttribute("data-cds-alert"),
						className: band.className,
					}
				: null,
		title: title.className,
		description: description.className,
	};
}

describe("ConfirmDialog", () =>
{
	it("puts initial focus on Cancel by default, and on the confirm button when asked", async () =>
	{
		const {unmount} = render(dialog());
		await waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Cancel");
		});
		unmount();
		render(
			<ConfirmDialog
				open
				onOpenChange={() =>
				{
				}}
				title="Remove saved draft?"
				confirmLabel="Remove"
				variant="danger"
				initialFocus="confirm"
				onConfirm={() =>
				{
				}}
			/>,
		);
		await waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Remove");
		});
	});

	it("renders upstream's panels ConfirmationDialog: a 16px body and the alert band title row (shared-frame jl/nf/jS/_z)", async () =>
	{
		render(dialog());
		expect(await anatomy()).toStrictEqual(
			{
				cds: "ConfirmationDialog",
				fizzy: "",
				popupPad: ["[--cds-pad-xl:var(--cds-pad-lg)]"],
				surface: ["rounded-dialog", "bg-surface-popover"],
				body: "isolate flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y rounded-[inherit] break-words p-4 m-[var(--ring-inner)]",
				band:
				{
					alert: "",
					className:
						"-mx-4 first:-mt-4 mb-1 flex shrink-0 items-center gap-1 self-stretch justify-self-stretch min-h-12 panels-fine:min-h-11 ps-4 pe-2 py-2 pointer-events-none",
				},
				title: "pointer-events-auto min-w-0 flex-1 last:me-2 text-[15px]/[21px] font-semibold break-words text-primary py-[5.5px] panels-fine:py-[3.5px]",
				description: "text-body font-normal text-secondary break-words -mt-[13.5px] panels-fine:-mt-[11.5px]",
			},
		);
	});

	it("draws Cancel and confirm as upstream's cds Buttons in the dialog-footer part, the danger confirm on the same geometry", async () =>
	{
		const {unmount} = render(dialog());
		const footer = (
			await screen.findByRole(
				"button",
				{
					name: "Cancel",
				},
			)
		).parentElement;
		const primary =
		{
			footer: footer?.getAttribute("data-cds-part") ?? null,
			cancel: screen.getByRole(
				"button",
				{
					name: "Cancel",
				},
			).className,
			confirm: screen.getByRole(
				"button",
				{
					name: "Delete",
				},
			).className,
		};
		unmount();
		render(
			<ConfirmDialog
				open
				onOpenChange={() =>
				{
				}}
				title="Remove saved draft?"
				confirmLabel="Remove"
				variant="danger"
				onConfirm={() =>
				{
				}}
			/>,
		);
		const danger = (
			await screen.findByRole(
				"button",
				{
					name: "Remove",
				},
			)
		).className;

		expect(
			{
				primary,
				danger,
			},
		).toStrictEqual(
			{
				primary:
				{
					footer: "dialog-footer",
					cancel: cdsButtonClass("secondary"),
					confirm: cdsButtonClass("primary"),
				},
				danger: cdsButtonClass("danger"),
			},
		);
	});

	it("keeps the pre-rollout layout without panels: a 24px popup pad, a plain 17/24 title and no band", async () =>
	{
		render(<PanelsOff>{dialog()}</PanelsOff>);
		expect(await anatomy()).toStrictEqual(
			{
				cds: "ConfirmationDialog",
				fizzy: null,
				popupPad: ["p-6"],
				surface: ["rounded-dialog", "bg-surface-popover"],
				body: "popup",
				band: null,
				title: "text-[17px] leading-6 font-semibold break-words text-primary",
				description: "mt-2 text-body break-words text-secondary",
			},
		);
	});

	it("wraps a live body in upstream's role=status span, and a disabled confirm can't be pressed", async () =>
	{
		const confirmed: string[] = [];
		render(
			<ConfirmDialog
				open
				onOpenChange={() =>
				{
				}}
				title="Archive older sessions?"
				body="Counting sessions older than a week…"
				bodyLive
				confirmLabel="Archive all"
				confirmDisabled
				onConfirm={() =>
				{
					confirmed.push("confirm");
				}}
			/>,
		);
		const status = await screen.findByRole("status");
		const confirm = screen.getByRole(
			"button",
			{
				name: "Archive all",
			},
		);
		fireEvent.click(confirm);

		expect(
			{
				tag: status.tagName,
				text: status.textContent,
				inDescription:
					status.parentElement?.id === screen.getByRole("alertdialog").getAttribute("aria-describedby"),
				disabled: confirm.hasAttribute("disabled"),
				confirmed,
			},
		).toStrictEqual(
			{
				tag: "SPAN",
				text: "Counting sessions older than a week…",
				inDescription: true,
				disabled: true,
				confirmed: [],
			},
		);
	});

	// Upstream's cds dialogs nest: the child backdrop is force-rendered (Base UI drops nested backdrops otherwise)
	// but goes transparent before a [data-nested] popup, and the parent popup's ::after scrim dims it instead.
	// jsdom evaluates neither :has() nor ::after, so this pins the classes and attributes that drive the CSS.
	it("force-renders a transparent nested backdrop and dims and blurs a confirm-look parent through its scrim", async () =>
	{
		function Nested()
		{
			const [confirmOpen, setConfirmOpen] = useState(true);
			return (
				<Dialog.Root open>
					<Dialog.Portal>
						<Dialog.Popup data-testid="parent">
							<ConfirmDialog
								open={confirmOpen}
								onOpenChange={setConfirmOpen}
								title="Delete session?"
								confirmLabel="Delete"
								onConfirm={() =>
								{
								}}
							/>
						</Dialog.Popup>
					</Dialog.Portal>
				</Dialog.Root>
			);
		}
		render(<Nested />);
		const confirm = await screen.findByRole("alertdialog");
		const parent = screen.getByTestId("parent");
		const backdrop = confirm.parentElement?.querySelector(":scope > [role='presentation']") ?? null;
		const confirmClasses = confirm.className.split(" ");
		const scrim = [
			"after:pointer-events-none",
			"after:bg-backdrop",
			"after:opacity-0",
			"data-[nested-dialog-open]:after:opacity-100",
			"data-[nested-dialog-open]:blur-[2px]",
		];

		await waitFor(() =>
		{
			expect(parent.hasAttribute("data-nested-dialog-open")).toBe(true);
		});
		expect(
			{
				confirmNested: confirm.hasAttribute("data-nested"),
				confirmScrim: scrim.filter((name) => confirmClasses.includes(name)),
				backdrop: backdrop?.className.split(" ").filter((name) => name.startsWith("has-[")) ?? null,
			},
		).toStrictEqual(
			{
				confirmNested: true,
				confirmScrim: scrim,
				backdrop: ["has-[~[data-nested]]:bg-transparent", "has-[~[data-nested]]:backdrop-blur-none"],
			},
		);

		// An alert dialog ignores outside presses, so the nested backdrop click closes nothing; Cancel closes only the confirm.
		if (backdrop !== null) fireEvent.click(backdrop);
		const afterBackdrop =
		{
			confirmOpen: screen.queryByRole("alertdialog") !== null,
			parentOpen: screen.queryByTestId("parent") !== null,
		};
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});
		expect(
			{
				afterBackdrop,
				parentOpen: screen.queryByTestId("parent") !== null,
				nestedOpen: parent.hasAttribute("data-nested-dialog-open"),
			},
		).toStrictEqual(
			{
				afterBackdrop:
				{
					confirmOpen: true,
					parentOpen: true,
				},
				parentOpen: true,
				nestedOpen: false,
			},
		);
	});

	it("still renders the dimming, blurring backdrop when not nested", async () =>
	{
		render(dialog());
		const confirm = await screen.findByRole("alertdialog");
		const backdrop = confirm.parentElement?.querySelector(":scope > [role='presentation']") ?? null;

		expect(
			["bg-backdrop", "backdrop-blur-[2px]"].filter((name) => backdrop?.classList.contains(name) === true),
		).toStrictEqual(["bg-backdrop", "backdrop-blur-[2px]"]);
	});
});
