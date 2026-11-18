// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SegmentedControl} from "../src/components/settings/segmented-control";
import {RESET_WRAPPER_CLASS, SettingRowChrome} from "../src/components/settings/setting-row-chrome";
import
{
	modifiedName,
	modifiedSentence,
	needsScopeBadge,
	optionDefaultLabel,
	scopeTooltip,
} from "../src/components/settings/setting-row-chrome-logic";
import {SettingsRow} from "../src/components/settings/settings-row";

afterEach(() =>
{
	cleanup();
});

describe("SettingRowChrome copy", () =>
{
	it("words the dot label and the Reset tooltip like upstream J()", () =>
	{
		expect([
			modifiedName("Narrow"),
			modifiedName(undefined),
			modifiedSentence("Narrow"),
			modifiedSentence(undefined),
		]).toStrictEqual([
			"Changed from the default (Narrow)",
			"Changed from the default",
			"Changed from the default (Narrow).",
			"Changed from the default.",
		]);
	});

	it("takes the default label from the option list (upstream De)", () =>
	{
		const options = [
			{
				value: "a",
				label: "Alpha",
			},
			{
				value: "b",
				label: "Beta",
			},
		];
		expect([optionDefaultLabel(options, "b"), optionDefaultLabel(options, "z")]).toStrictEqual(["Beta", undefined]);
	});
});

describe("SettingRowChrome", () =>
{
	function shape(props: Parameters<typeof SettingRowChrome>[0])
	{
		const {container} = render(<SettingRowChrome {...props} />);
		const strip = container.firstElementChild;
		const result =
		{
			strip: strip?.className ?? null,
			dot: container.querySelector("[data-testid=setting-modified-dot]")?.getAttribute("aria-label") ?? null,
			badge: container.querySelector("[data-cds=Badge]")?.textContent ?? null,
			reset: container.querySelector("button")?.getAttribute("aria-label") ?? null,
		};
		cleanup();
		return result;
	}

	it("shows the dot, Managed badge and Reset for each modified × managed × onReset combination", () =>
	{
		const onReset = () =>
		{
		};
		const base =
		{
			defaultLabel: "Narrow",
			labelText: "Transcript width",
		};
		const strip = "inline-flex h-5 items-center gap-1.5";
		expect(
			{
				plain: shape(
					{
						...base,
						modified: false,
						managed: false,
						onReset,
					},
				),
				modified: shape(
					{
						...base,
						modified: true,
						managed: false,
						onReset,
					},
				),
				modifiedNoReset: shape(
					{
						...base,
						modified: true,
						managed: false,
					},
				),
				managed: shape(
					{
						...base,
						modified: false,
						managed: true,
						onReset,
					},
				),
				managedModified: shape(
					{
						...base,
						modified: true,
						managed: true,
						onReset,
					},
				),
			},
		).toStrictEqual(
			{
				plain:
				{
					strip: null,
					dot: null,
					badge: null,
					reset: null,
				},
				modified:
				{
					strip,
					dot: "Changed from the default (Narrow)",
					badge: null,
					reset: "Reset Transcript width to default",
				},
				modifiedNoReset:
				{
					strip,
					dot: "Changed from the default (Narrow)",
					badge: null,
					reset: null,
				},
				managed:
				{
					strip,
					dot: null,
					badge: "Managed",
					reset: null,
				},
				managedModified:
				{
					strip,
					dot: null,
					badge: "Managed",
					reset: null,
				},
			},
		);
	});

	it("draws upstream's 6px accent dot, a hover/focus/coarse-revealed wrapper and a ghost xxs Reset", () =>
	{
		const onReset = vi.fn<() => void>();
		const {container} = render(<SettingRowChrome modified managed={false} labelText="" onReset={onReset} />);
		const button = screen.getByRole(
			"button",
			{
				name: "Reset to default",
			},
		);
		fireEvent.click(button);
		expect(
			{
				dot: container.querySelector("[data-testid=setting-modified-dot]")?.outerHTML,
				wrapper: button.closest(`span.${CSS.escape("opacity-0")}`)?.className,
				text: button.textContent,
				buttonClass: button.className,
				calls: onReset.mock.calls.length,
			},
		).toStrictEqual(
			{
				dot: '<span role="img" aria-label="Changed from the default" data-testid="setting-modified-dot" class="inline-block size-1.5 shrink-0 rounded-full bg-fill-accent"></span>',
				wrapper: RESET_WRAPPER_CLASS,
				text: "Reset",
				buttonClass:
					"inline-flex h-5 items-center gap-1 rounded-r4 px-1.5 text-[12px]/[15px] text-primary outline-none hover:bg-alpha-1 focus-visible:bg-alpha-1 focus-visible:shadow-focus",
				calls: 1,
			},
		);
		expect(RESET_WRAPPER_CLASS).toBe(
			"inline-flex opacity-0 transition-opacity group-hover/setting:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100",
		);
	});

	it("opens the Reset tooltip with the sentence copy on focus", () =>
	{
		vi.useFakeTimers();
		try
		{
			render(
				<SettingRowChrome
					modified
					managed={false}
					defaultLabel="Narrow"
					labelText="T"
					onReset={() =>
					{
					}}
				/>,
			);
			const button = screen.getByRole("button");
			act(() =>
			{
				fireEvent.focus(button);
				vi.advanceTimersByTime(1000);
			});
			expect(screen.getByRole("tooltip").textContent).toBe("Changed from the default (Narrow).");
		}
		finally
		{
			vi.useRealTimers();
		}
	});
});

const OPTIONS = [
	{
		value: "narrow",
		label: "Narrow",
	},
	{
		value: "wide",
		label: "Wide",
	},
] as const;

function ResettableRow()
{
	const [value, setValue] = useState<"narrow" | "wide">("wide");
	return (
		<SettingsRow
			slug="w"
			title="Width"
			labelAdornment={
				<SettingRowChrome
					modified={value !== "narrow"}
					managed={false}
					defaultLabel="Narrow"
					labelText="Width"
					onReset={() =>
					{
						setValue("narrow");
					}}
				/>
			}
		>
			<SegmentedControl aria-label="Width" value={value} options={OPTIONS} onValueChange={setValue} />
		</SettingsRow>
	);
}

describe("Reset focus handoff (upstream LO/ve)", () =>
{
	it("moves keyboard focus to the row's checked radio when Reset unmounts", async () =>
	{
		render(<ResettableRow />);
		const reset = screen.getByRole(
			"button",
			{
				name: "Reset Width to default",
			},
		);
		reset.focus();
		fireEvent.keyDown(
			reset,
			{
				key: "Enter",
			},
		);
		fireEvent.click(
			reset,
			{
				detail: 0,
			},
		);
		await act(async () =>
		{
			await Promise.resolve();
		});
		expect(
			{
				active: document.activeElement?.getAttribute("role"),
				checked: document.activeElement?.getAttribute("aria-checked"),
				label: document.activeElement?.textContent,
			},
		).toStrictEqual(
			{
				active: "radio",
				checked: "true",
				label: "Narrow",
			},
		);
	});

	it("leaves focus alone after a mouse click on Reset", async () =>
	{
		render(<ResettableRow />);
		const reset = screen.getByRole(
			"button",
			{
				name: "Reset Width to default",
			},
		);
		fireEvent.pointerDown(reset);
		reset.focus();
		fireEvent.click(
			reset,
			{
				detail: 1,
			},
		);
		await act(async () =>
		{
			await Promise.resolve();
		});
		expect(document.activeElement?.getAttribute("role")).not.toBe("radio");
	});
});

describe("scope primitive (upstream ye/be)", () =>
{
	it("needs a badge when managed or when the provider scope differs from the row's", () =>
	{
		expect([
			needsScopeBadge("device", null, false),
			needsScopeBadge("device", "device", false),
			needsScopeBadge("device", "account", false),
			needsScopeBadge("device", null, true),
		]).toStrictEqual([false, false, true, true]);
	});

	it("words the scope tooltip per storage, appending the session-override sentence", () =>
	{
		expect([
			scopeTooltip("account", "app", false),
			scopeTooltip("device", "claudeCodeSetting", false),
			scopeTooltip("device", "app", false),
			scopeTooltip("device", "app", true),
		]).toStrictEqual([
			"Applies on every device you sign in to.",
			"Applies to Claude Code on this computer, including the terminal.",
			"Applies only on this computer.",
			"Applies only on this computer. New sessions start with it, and each session can change its own.",
		]);
	});

	it("renders This computer plus a More info InfoTip when the scope badge is needed", () =>
	{
		const {container} = render(
			<SettingRowChrome
				modified={false}
				managed={false}
				labelText="T"
				scopeBadge={
				{
					scope: "device",
					tooltip: "Applies only on this computer.",
				}}
			/>,
		);
		expect(
			{
				badge: container.querySelector("[data-cds=Badge]")?.textContent,
				info: screen.getByRole("button").getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				badge: "This computer",
				info: "More info",
			},
		);
	});
});
