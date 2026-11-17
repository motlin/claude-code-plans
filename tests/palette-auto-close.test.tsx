// @vitest-environment jsdom

import
{
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {act, cleanup, render, waitFor} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {usePaletteAutoClose} from "../src/hooks/use-palette-auto-close";
import type {PaletteAutoCloseReason, PaletteCloseHold} from "../src/lib/palette-close-hold";

interface ProbeProps
{
	enabled: boolean;
	hold: PaletteCloseHold;
	onClose: (reason: PaletteAutoCloseReason) => void;
}

let probeProps: ProbeProps;
let setProbeProps: ((props: ProbeProps) => void) | null = null;

function Probe()
{
	const [props, setProps] = useState(probeProps);
	setProbeProps = setProps;
	usePaletteAutoClose(props);
	return null;
}

async function mount(initial: ProbeProps, loader?: () => Promise<void>)
{
	probeProps = initial;
	const rootRoute = createRootRoute(
		{
			component: () => (
				<>
					<Probe />
					<Outlet />
				</>
			),
		},
	);
	const route = (path: string) =>
		createRoute(
			{
				getParentRoute: () => rootRoute,
				path,
				component: () => null,
				...(loader === undefined || path !== "slow"
					? {}
					:
						{
							loader,
						}),
			},
		);
	const router = createRouter(
		{
			routeTree: rootRoute.addChildren([route("/"), route("plans"), route("memories"), route("slow")]),
			history: createMemoryHistory(
				{
					initialEntries: ["/"],
				},
			),
		},
	);
	await router.load();
	render(<RouterProvider router={router} />);
	return router;
}

function rerender(props: ProbeProps)
{
	act(() =>
	{
		setProbeProps?.(props);
	});
}

async function navigate(router: Awaited<ReturnType<typeof mount>>, href: string)
{
	await act(async () =>
	{
		await router.navigate(
			{
				href,
			},
		);
	});
}

function appendDialog(
	attributes: Record<string, string> =
	{
		"data-cds": "Dialog",
	},
): HTMLElement
{
	const node = document.createElement("div");
	for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
	document.body.append(node);
	return node;
}

async function flushObserver()
{
	await act(async () =>
	{
		await Promise.resolve();
	});
}

describe("usePaletteAutoClose (upstream A7)", () =>
{
	afterEach(() =>
	{
		cleanup();
		document.body.innerHTML = "";
		setProbeProps = null;
	});

	it("closes on a pathname change while idle", async () =>
	{
		const onClose = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		const router = await mount(
			{
				enabled: true,
				hold: "none",
				onClose,
			},
		);

		await navigate(router, "/plans");

		expect(onClose.mock.calls).toStrictEqual([["route"]]);
	});

	it("survives a route change under an input hold", async () =>
	{
		const onClose = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		const router = await mount(
			{
				enabled: true,
				hold: "input",
				onClose,
			},
		);

		await navigate(router, "/plans");

		expect(onClose.mock.calls).toStrictEqual([]);
	});

	it("ignores a search-only change", async () =>
	{
		const onClose = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		const router = await mount(
			{
				enabled: true,
				hold: "none",
				onClose,
			},
		);

		await navigate(router, "/?x=1");

		expect(onClose.mock.calls).toStrictEqual([]);
	});

	it("closes when another dialog opens, under none and under input", async () =>
	{
		const idle = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		await mount(
			{
				enabled: true,
				hold: "none",
				onClose: idle,
			},
		);
		appendDialog();
		await waitFor(() =>
		{
			expect(idle.mock.calls).toStrictEqual([["dialog"]]);
		});
		cleanup();
		document.body.innerHTML = "";

		const typing = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		await mount(
			{
				enabled: true,
				hold: "input",
				onClose: typing,
			},
		);
		appendDialog(
			{
				role: "alertdialog",
			},
		);
		await waitFor(() =>
		{
			expect(typing.mock.calls).toStrictEqual([["dialog"]]);
		});
	});

	it("remembers a dialog refused under all and closes only once the hold reaches none", async () =>
	{
		const onClose = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		await mount(
			{
				enabled: true,
				hold: "all",
				onClose,
			},
		);
		appendDialog();
		await flushObserver();
		const whileHeld = [...onClose.mock.calls];

		rerender(
			{
				enabled: true,
				hold: "input",
				onClose,
			},
		);
		const atInput = [...onClose.mock.calls];
		rerender(
			{
				enabled: true,
				hold: "none",
				onClose,
			},
		);

		expect(
			{
				whileHeld,
				atInput,
				atNone: onClose.mock.calls,
			},
		).toStrictEqual(
			{
				whileHeld: [],
				atInput: [],
				atNone: [["dialog"]],
			},
		);
	});

	it("stays open on release when the refused dialog has already closed or left", async () =>
	{
		const onClose = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		await mount(
			{
				enabled: true,
				hold: "all",
				onClose,
			},
		);
		const closing = appendDialog();
		const leaving = appendDialog();
		await flushObserver();
		closing.setAttribute("data-closed", "");
		leaving.remove();
		await flushObserver();

		rerender(
			{
				enabled: true,
				hold: "none",
				onClose,
			},
		);

		expect(onClose.mock.calls).toStrictEqual([]);
	});

	it("ignores dialogs open before it enabled and palette-owned dialogs", async () =>
	{
		const onClose = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		const before = appendDialog();
		await mount(
			{
				enabled: false,
				hold: "none",
				onClose,
			},
		);
		rerender(
			{
				enabled: true,
				hold: "none",
				onClose,
			},
		);
		before.setAttribute("data-open", "");
		appendDialog(
			{
				"data-cds": "Dialog",
				"data-palette-owned": "",
			},
		);
		await flushObserver();

		expect(onClose.mock.calls).toStrictEqual([]);
	});

	it("does nothing while disabled", async () =>
	{
		const onClose = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		const router = await mount(
			{
				enabled: false,
				hold: "none",
				onClose,
			},
		);

		await navigate(router, "/plans");
		appendDialog();
		await flushObserver();

		expect(onClose.mock.calls).toStrictEqual([]);
	});

	it("lets a palette opened mid-navigation survive that navigation landing", async () =>
	{
		let release: () => void = () =>
		{
		};
		const gate = new Promise<void>((resolve) =>
		{
			release = resolve;
		});
		const onClose = vi.fn<(reason: PaletteAutoCloseReason) => void>();
		const router = await mount(
			{
				enabled: false,
				hold: "none",
				onClose,
			},
			async () => gate,
		);
		let landed: Promise<void> = Promise.resolve();
		act(() =>
		{
			landed = router.navigate(
				{
					href: "/slow",
				},
			);
		});
		await waitFor(() =>
		{
			expect(router.state.location.pathname).toBe("/slow");
		});
		expect(router.state.resolvedLocation?.pathname).toBe("/");

		rerender(
			{
				enabled: true,
				hold: "none",
				onClose,
			},
		);
		await act(async () =>
		{
			release();
			await landed;
		});
		const afterLanding = [...onClose.mock.calls];
		await navigate(router, "/memories");

		expect(
			{
				afterLanding,
				afterNext: onClose.mock.calls,
			},
		).toStrictEqual(
			{
				afterLanding: [],
				afterNext: [["route"]],
			},
		);
	});
});
