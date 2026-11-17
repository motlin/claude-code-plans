// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {NewOutputStyleDialog} from "../src/components/new-output-style-dialog";

const STYLE_PATH = "/Users/alice/.claude/output-styles/terse.md";

interface Call
{
	url: string;
	body: unknown;
	signal: AbortSignal | null | undefined;
}

const calls: Call[] = [];

function stubFetch(routes: Record<string, () => Response | Promise<Response>>)
{
	calls.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
		{
			const url = String(input);
			calls.push(
				{
					url,
					body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
					signal: init?.signal,
				},
			);
			const route = routes[url];
			return route === undefined
				? Response.json(
						{
							error: "unexpected",
						},
						{
							status: 500,
						},
					)
				: route();
		}),
	);
}

const created = () =>
	Response.json(
		{
			outcome: "created",
			name: "Terse",
			path: STYLE_PATH,
			refreshed: false,
			selected: false,
		},
	);

async function flush()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

function renderDialog()
{
	const onClose = vi.fn<() => void>();
	const onCreated = vi.fn<(name: string) => void>();
	render(<NewOutputStyleDialog onClose={onClose} onCreated={onCreated} />);
	return {
		onClose,
		onCreated,
	};
}

const describeField = () => screen.getByLabelText("What should the style be like?");
const nameField = () => screen.getByLabelText("Name (optional)");
const button = (name: string) =>
	screen.getByRole(
		"button",
		{
			name,
		},
	);

function type(field: HTMLElement, value: string)
{
	fireEvent.change(
		field,
		{
			target:
			{
				value,
			},
		},
	);
}

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("NewOutputStyleDialog", () =>
{
	it("opens on the description with Create style disabled until it has text", async () =>
	{
		stubFetch({});
		renderDialog();
		await waitFor(() =>
		{
			expect(document.activeElement).toBe(describeField());
		});
		const before = (button("Create style") as HTMLButtonElement).disabled;
		type(describeField(), "Short answers first");
		expect(
			{
				title: screen.getByRole("dialog").getAttribute("aria-labelledby") !== null,
				heading: screen.getByText("New output style").textContent,
				description: screen.getByText("Describe the style, and Claude will draft it for you.").tagName,
				placeholder: describeField().getAttribute("placeholder"),
				before,
				after: (button("Create style") as HTMLButtonElement).disabled,
			},
		).toStrictEqual(
			{
				title: true,
				heading: "New output style",
				description: "P",
				placeholder: "Short answers first, then detail. No filler words.",
				before: true,
				after: false,
			},
		);
	});

	it("drafts with the fields disabled, then shows upstream's not-refreshed done copy", async () =>
	{
		let resolve: (response: Response) => void = () =>
		{
		};
		const promise = new Promise<Response>((settle) =>
		{
			resolve = settle;
		});
		stubFetch(
			{
				"/api/output-styles": async () => promise,
			},
		);
		const {onCreated} = renderDialog();
		type(describeField(), "Short answers first");
		fireEvent.click(button("Create style"));
		await flush();
		const drafting =
		{
			busy: button("Drafting…").getAttribute("aria-busy"),
			description: (describeField() as HTMLTextAreaElement).disabled,
			name: (nameField() as HTMLInputElement).disabled,
		};
		resolve(created());
		await flush();
		expect(
			{
				drafting,
				body: calls[0]?.body,
				done: screen.getByText(
					"Created Terse. It appears in the menu after the next style refresh — pick it there.",
				).textContent,
				buttons: screen
					.getAllByRole("button")
					.map((element) => element.getAttribute("aria-label") ?? element.textContent),
				created: onCreated.mock.calls,
			},
		).toStrictEqual(
			{
				drafting:
				{
					busy: "true",
					description: true,
					name: true,
				},
				body:
				{
					description: "Short answers first",
				},
				done: "Created Terse. It appears in the menu after the next style refresh — pick it there.",
				buttons: ["Close", "Show in Finder", "Done"],
				created: [["Terse"]],
			},
		);
	});

	it("shows the name error from validation without creating", async () =>
	{
		stubFetch(
			{
				"/api/output-styles/validate": () =>
					Response.json(
						{
							ok: false,
							reason: "exists",
						},
					),
			},
		);
		renderDialog();
		type(describeField(), "Short answers first");
		type(nameField(), "Learning");
		fireEvent.click(button("Create style"));
		await flush();
		expect(
			{
				error: screen.getByText("A style with this name already exists.").textContent,
				invalid: nameField().getAttribute("aria-invalid"),
				urls: calls.map((call) => call.url),
			},
		).toStrictEqual(
			{
				error: "A style with this name already exists.",
				invalid: "true",
				urls: ["/api/output-styles/validate"],
			},
		);
	});

	it("shows upstream's alert for a failed draft", async () =>
	{
		stubFetch(
			{
				"/api/output-styles": () =>
					Response.json(
						{
							outcome: "draft_failed",
						},
					),
			},
		);
		renderDialog();
		type(describeField(), "Short answers first");
		fireEvent.click(button("Create style"));
		await flush();
		expect(screen.getByRole("alert").textContent).toStrictEqual("Couldn’t draft the style. Try again.");
	});

	it("guards a dirty Cancel with Discard unsaved changes?, and closes a clean one at once", async () =>
	{
		stubFetch({});
		const {onClose} = renderDialog();
		type(describeField(), "Short answers first");
		fireEvent.click(button("Cancel"));
		await flush();
		const guard = screen.getByRole("alertdialog").textContent;
		fireEvent.click(button("Keep editing"));
		await flush();
		const kept = (describeField() as HTMLTextAreaElement).value;
		fireEvent.click(button("Cancel"));
		await flush();
		fireEvent.click(button("Discard"));
		await flush();
		const discarded = onClose.mock.calls.length;
		cleanup();

		const clean = renderDialog();
		fireEvent.click(button("Cancel"));
		await flush();
		expect(
			{
				guard,
				kept,
				discarded,
				clean: clean.onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				guard: "Discard unsaved changes?Your changes haven’t been saved and will be lost.Keep editingDiscard",
				kept: "Short answers first",
				discarded: 1,
				clean: 1,
			},
		);
	});

	it("aborts the draft when cancelled mid-draft", async () =>
	{
		stubFetch(
			{
				"/api/output-styles": async () => new Promise<Response>(() => {}),
			},
		);
		const {onClose} = renderDialog();
		type(describeField(), "Short answers first");
		fireEvent.click(button("Create style"));
		await flush();
		fireEvent.click(button("Cancel"));
		await flush();
		expect(
			{
				aborted: calls[0]?.signal?.aborted,
				closed: onClose.mock.calls.length,
			},
		).toStrictEqual(
			{
				aborted: true,
				closed: 1,
			},
		);
	});

	it("turns Show in Finder into a disabled File not found when the file is gone", async () =>
	{
		stubFetch(
			{
				"/api/output-styles": created,
				"/api/reveal-in-finder": () =>
					Response.json(
						{
							error: "File not found",
						},
						{
							status: 404,
						},
					),
			},
		);
		renderDialog();
		type(describeField(), "Short answers first");
		fireEvent.click(button("Create style"));
		await flush();
		fireEvent.click(button("Show in Finder"));
		await flush();
		expect(
			{
				body: calls.at(-1)?.body,
				disabled: (button("File not found") as HTMLButtonElement).disabled,
			},
		).toStrictEqual(
			{
				body:
				{
					path: STYLE_PATH,
				},
				disabled: true,
			},
		);
	});
});
