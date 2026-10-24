// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import type React from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {deferredComponent, deferredModule, useLoadedModule} from "../src/components/deferred-component";

function Greeting({name}: {name: string}) {
	return <p>Hello {name}</p>;
}

const greetingModule = {Greeting};

function controlledLoad() {
	let settle!: (outcome: "resolve" | "reject") => void;
	const load = vi.fn<() => Promise<typeof greetingModule>>(
		async () =>
			new Promise<typeof greetingModule>((resolve, reject) => {
				settle = (outcome) => {
					if (outcome === "resolve") resolve(greetingModule);
					else reject(new Error("Example chunk unavailable"));
				};
			}),
	);
	return {
		load,
		settle: (outcome: "resolve" | "reject") => {
			settle(outcome);
		},
	};
}

/** Renders in an awaited act scope, where React retries a render that suspended once its promise settles. */
async function renderAsync(element: React.ReactElement) {
	let view!: ReturnType<typeof render>;
	await act(async () => {
		view = render(element);
		await Promise.resolve();
	});
	return view;
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("deferredComponent", () => {
	it("renders nothing while the module downloads, then the component, and renders a later instance in the first pass", async () => {
		const {load, settle} = controlledLoad();
		const module = deferredModule(load);
		const DeferredGreeting = deferredComponent(module, "Greeting");

		const first = await renderAsync(<DeferredGreeting name="Ada" />);
		const pending = first.container.innerHTML;
		settle("resolve");
		await screen.findByText("Hello Ada", {}, {timeout: 1000});
		const loaded = first.container.innerHTML;

		const second = render(<DeferredGreeting name="Grace" />);
		const firstPass = second.container.innerHTML;

		expect({pending, loaded, firstPass, downloads: load.mock.calls.length}).toStrictEqual({
			pending: "",
			loaded: "<p>Hello Ada</p>",
			firstPass: "<p>Hello Grace</p>",
			downloads: 1,
		});
	});

	it("renders nothing after a failed download and downloads again on the next preload", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const {load, settle} = controlledLoad();
		const module = deferredModule(load);
		const DeferredGreeting = deferredComponent(module, "Greeting");

		const view = await renderAsync(<DeferredGreeting name="Ada" />);
		settle("reject");
		await flush();
		const failed = {html: view.container.innerHTML, loaded: module.loaded()};

		const retry = module.preload();
		settle("resolve");
		await retry;
		const remounted = render(<DeferredGreeting name="Ada" />);

		expect({failed, retried: remounted.container.innerHTML, downloads: load.mock.calls.length}).toStrictEqual({
			failed: {html: "", loaded: undefined},
			retried: "<p>Hello Ada</p>",
			downloads: 2,
		});
	});
});

describe("useLoadedModule", () => {
	it("re-renders its caller with the module once it arrives", async () => {
		const {load, settle} = controlledLoad();
		const module = deferredModule(load);
		function Probe() {
			const loaded = useLoadedModule(module);
			return <span>{loaded === undefined ? "pending" : "loaded"}</span>;
		}

		const view = render(<Probe />);
		const before = view.container.textContent;
		const preload = module.preload();
		settle("resolve");
		await act(async () => {
			await preload;
		});

		expect({before, after: view.container.textContent}).toStrictEqual({before: "pending", after: "loaded"});
	});
});
