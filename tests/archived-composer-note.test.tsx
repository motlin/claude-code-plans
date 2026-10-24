// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ArchivedComposerNote} from "../src/components/archived-composer-note";
import {ToastProvider} from "../src/components/toast";

const SESSION_ID = "8f0c2c7e-1111-4222-8333-944445555666";
const ARCHIVED_URL = `/api/sessions/${SESSION_ID}/archived`;

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function renderNote() {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
	return render(
		<QueryClientProvider client={queryClient}>
			<ToastProvider>
				<ArchivedComposerNote sessionId={SESSION_ID} />
			</ToastProvider>
		</QueryClientProvider>,
	);
}

function toastTexts(): string[] {
	return [...document.querySelectorAll("[data-toast]")].map((toast) => toast.textContent);
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("ArchivedComposerNote", () => {
	it("renders upstream's archived note band in place of the composer", () => {
		renderNote();
		const note = screen.getByRole("note");
		expect({
			text: note.textContent,
			standIn: note.getAttribute("data-composer-stand-in"),
			className: note.className,
			button: within(note).getByRole("button").textContent,
		}).toEqual({
			text: "This session is archived. Unarchive it to keep working in this session.Unarchive",
			standIn: "",
			className:
				"flex gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 items-start py-[calc((40px-1lh)/2)] text-[13px]/[19px] band-enter",
			button: "Unarchive",
		});
	});

	it("shows the busy button and Unarchiving… while the request runs, then toasts Session unarchived.", async () => {
		let resolve: (response: Response) => void = () => undefined;
		fetchMock.mockImplementation(
			async () =>
				new Promise<Response>((r) => {
					resolve = r;
				}),
		);
		renderNote();
		const note = screen.getByRole("note");
		fireEvent.click(within(note).getByRole("button", {name: "Unarchive"}));
		await flush();

		const button = within(note).getByRole("button");
		expect({
			calls: fetchMock.mock.calls.map(([url, init]) => ({url, method: init?.method})),
			busy: button.getAttribute("aria-busy"),
			disabled: (button as HTMLButtonElement).disabled,
			status: within(note).getByRole("status").textContent,
			toasts: toastTexts(),
		}).toEqual({
			calls: [{url: ARCHIVED_URL, method: "DELETE"}],
			busy: "true",
			disabled: true,
			status: "Unarchiving…",
			toasts: [],
		});

		act(() => {
			resolve(Response.json({archived: false}));
		});
		await flush();

		expect({
			busy: within(note).getByRole("button").getAttribute("aria-busy"),
			status: within(note).queryByRole("status"),
			toasts: toastTexts(),
		}).toEqual({busy: null, status: null, toasts: ["Session unarchived."]});
	});
});
