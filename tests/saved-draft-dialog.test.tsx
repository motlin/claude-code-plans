// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {AttachedContextChips} from "../src/components/attached-context-chips";
import
{
	attachContext,
	getContextChips,
	registerComposer,
	takeContextChips,
	useContextChips,
} from "../src/lib/context-attach";

const SESSION = "session-frank";
const TEXT = "Frank's very long draft";

let stop: () => void = () =>
{
};

function LiveChips()
{
	return <AttachedContextChips sessionId={SESSION} context={useContextChips(SESSION)} comments={[]} />;
}

beforeEach(() =>
{
	localStorage.clear();
	stop = registerComposer(
		SESSION,
		{
			insertText: () =>
			{
			},
			focus: () =>
			{
			},
		},
	);
	attachContext(
		SESSION,
		{
			kind: "saved-draft",
			text: TEXT,
		},
	);
});

afterEach(() =>
{
	cleanup();
	takeContextChips(SESSION);
	stop();
	localStorage.clear();
});

function pillBody(container: HTMLElement): HTMLButtonElement
{
	const body = container.querySelector<HTMLButtonElement>("button.epitaxy-pill-body");
	if (body === null) throw new Error("no saved draft pill");
	return body;
}

async function openDialog(container: HTMLElement)
{
	const body = pillBody(container);
	body.focus();
	fireEvent.click(body);
	const dialog = await screen.findByRole("dialog");
	const textarea = screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Saved draft text",
		},
	);
	await vi.waitFor(() =>
	{
		expect(document.activeElement).toBe(textarea);
	});
	return {
		dialog,
		textarea,
		save: screen.getByRole<HTMLButtonElement>(
			"button",
			{
				name: "Save",
			},
		),
	};
}

function edit(textarea: HTMLTextAreaElement, value: string)
{
	fireEvent.change(
		textarea,
		{
			target:
			{
				value,
			},
		},
	);
}

async function closed()
{
	await vi.waitFor(() =>
	{
		expect(screen.queryByRole("dialog")).toBeNull();
	});
}

async function alert()
{
	const dialog = await screen.findByRole("alertdialog");
	return {
		title: dialog.querySelector("h2")?.textContent,
		body: dialog.querySelector("p")?.textContent,
		buttons: [...dialog.querySelectorAll("button")].map((button) => button.textContent),
	};
}

describe("Saved draft dialog", () =>
{
	it("opens upstream's 3xl Saved draft editor, focused, with Save disabled until the first edit", async () =>
	{
		const {container} = render(<LiveChips />);
		const {dialog, textarea, save} = await openDialog(container);
		const box = textarea.parentElement;
		const footer = save.parentElement;
		const before = save.disabled;
		const initial = textarea.value;
		edit(textarea, `${TEXT}!`);
		expect(
			{
				cds: dialog.getAttribute("data-cds"),
				wide: dialog.className.split(" ").includes("max-w-[1152px]"),
				title: dialog.querySelector("h2")?.textContent,
				box: box?.className,
				textarea: textarea.className.split(" ").includes("text-code"),
				value: initial,
				footer: footer?.className,
				buttons: [...(footer?.querySelectorAll("button") ?? [])].map((button) => button.textContent),
				before,
				after: save.disabled,
			},
		).toStrictEqual(
			{
				cds: "Dialog",
				wide: true,
				title: "Saved draft",
				box: "flex max-h-64 flex-col overflow-hidden rounded border border-alpha-3",
				textarea: true,
				value: TEXT,
				footer: "mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
				buttons: ["Cancel", "Save"],
				before: true,
				after: false,
			},
		);
	});

	it("asks before discarding edits: Keep editing (focused) stays, Discard closes and focuses the pill", async () =>
	{
		const {container} = render(<LiveChips />);
		const {textarea} = await openDialog(container);
		edit(textarea, "changed");
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		const asked = await alert();
		await vi.waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Keep editing");
		});
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Discard",
				},
			),
		);
		await closed();
		await vi.waitFor(() =>
		{
			expect(document.activeElement).toBe(pillBody(container));
		});
		expect(
			{
				asked,
				text: getContextChips(SESSION).map((chip) => chip.text),
			},
		).toStrictEqual(
			{
				asked:
				{
					title: "Discard changes?",
					body: "Your edits won’t be saved.",
					buttons: ["Keep editing", "Discard"],
				},
				text: [TEXT],
			},
		);
	});

	it("asks before Escape discards edits too", async () =>
	{
		const {container} = render(<LiveChips />);
		const {textarea} = await openDialog(container);
		edit(textarea, "changed");
		fireEvent.keyDown(
			textarea,
			{
				key: "Escape",
			},
		);
		expect((await alert()).title).toBe("Discard changes?");
	});

	it("asks before saving blank text: Cancel goes back to the editor, Remove deletes the chip", async () =>
	{
		const {container} = render(<LiveChips />);
		const {textarea, save} = await openDialog(container);
		edit(textarea, "   ");
		fireEvent.click(save);
		const asked = await alert();
		await vi.waitFor(() =>
		{
			expect(document.activeElement?.textContent).toBe("Remove");
		});
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		await vi.waitFor(() =>
		{
			expect(document.activeElement).toBe(textarea);
		});
		fireEvent.click(save);
		await alert();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Remove",
				},
			),
		);
		await closed();
		await vi.waitFor(() =>
		{
			expect(getContextChips(SESSION)).toStrictEqual([]);
		});
		expect(asked).toStrictEqual(
			{
				title: "Remove saved draft?",
				body: "This is the only copy of this text.",
				buttons: ["Cancel", "Remove"],
			},
		);
	});

	it("saves edited text in place: the pill stays, recounts, persists and takes focus", async () =>
	{
		const {container} = render(<LiveChips />);
		const {textarea, save} = await openDialog(container);
		edit(textarea, "hello");
		fireEvent.click(save);
		await closed();
		await vi.waitFor(() =>
		{
			expect(document.activeElement).toBe(pillBody(container));
		});
		expect(
			{
				chips: getContextChips(SESSION).map(({kind, text}) => [kind, text]),
				aria: pillBody(container).getAttribute("aria-label"),
				stored: localStorage.getItem(`ccp-composer-attachments:${SESSION}`),
			},
		).toStrictEqual(
			{
				chips: [["saved-draft", "hello"]],
				aria: "Saved draft · 5 characters",
				stored: JSON.stringify([
					{
						kind: "saved-draft",
						text: "hello",
					},
				]),
			},
		);
	});

	it("saves on ⌘⏎ in the editor", async () =>
	{
		const {container} = render(<LiveChips />);
		const {textarea} = await openDialog(container);
		edit(textarea, "via keyboard");
		fireEvent.keyDown(
			textarea,
			{
				key: "Enter",
				metaKey: true,
			},
		);
		await closed();
		expect(getContextChips(SESSION).map((chip) => chip.text)).toStrictEqual(["via keyboard"]);
	});

	it("opens from the context menu's Edit", async () =>
	{
		const {container} = render(<LiveChips />);
		fireEvent.contextMenu(
			pillBody(container),
			{
				clientX: 10,
				clientY: 10,
			},
		);
		fireEvent.click(
			await screen.findByRole(
				"menuitem",
				{
					name: "Edit",
				},
			),
		);
		const textarea = await screen.findByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Saved draft text",
			},
		);
		expect(textarea.value).toBe(TEXT);
	});

	it("is read-only while an upload is in flight: no remove, Click to view., Save disabled", async () =>
	{
		const {container} = render(
			<AttachedContextChips
				sessionId={SESSION}
				context={[
					...getContextChips(SESSION),
					{
						id: "chip-pending",
						kind: "image",
						name: "shot.png",
						previewUrl: "blob:shot",
						status: "pending",
					},
				]}
				comments={[]}
			/>,
		);
		fireEvent.focus(pillBody(container));
		const detail = screen.getByRole("tooltip").lastElementChild?.textContent;
		const remove = container.querySelector("button.epitaxy-pill-remove");
		const {textarea, save} = await openDialog(container);
		edit(textarea, "changed");
		expect(
			{
				detail,
				remove,
				readOnly: textarea.readOnly,
				save: save.disabled,
			},
		).toStrictEqual(
			{
				detail: "Click to view.",
				remove: null,
				readOnly: true,
				save: true,
			},
		);
	});
});
