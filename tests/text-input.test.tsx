// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Field, TextInput} from "../src/components/ui/text-input";

afterEach(cleanup);

const SHELL = [
	"h-control",
	"ps-md",
	"rounded",
	"bg-fill-field",
	"shadow-field-ring",
	"data-[invalid]:shadow-field-invalid",
	"font-sans",
	"text-body",
	"font-normal",
	"text-primary",
	"transition",
	"duration-fast",
];
const TAIL = [
	"has-[[data-cds-end-slot]_[data-cds=Button]:not([data-cds-ghost])]:pe-[calc((var(--cds-h-control)-var(--cds-h-control-nested))/2)]",
	"inline-flex",
	"w-full",
	"min-w-0",
	"cursor-text",
	"items-center",
	"gap-[var(--cds-pad-sm,6px)]",
	"has-[:focus-visible]:shadow-focus",
	"data-[invalid]:has-[:focus-visible]:shadow-focus-danger",
	"has-[input:disabled]:opacity-disabled",
	"[&:hover:not(:focus-visible):not(:has(:focus-visible)):not([data-invalid]):not([data-disabled])]:shadow-field-hover",
];
function noop()
{
}

const NESTED_PE = "pe-[calc((var(--cds-h-control)-var(--cds-h-control-nested))/2)]";

function Filter({
	initial = "",
	onClear = noop,
	onKeyDown,
}: {
	initial?: string;
	onClear?: () => void;
	onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
})
{
	const [value, setValue] = useState(initial);
	return (
		<TextInput
			aria-label="Filter files"
			value={value}
			onChange={(event) =>
			{
				setValue(event.target.value);
			}}
			{...(onKeyDown !== undefined &&
			{
				onKeyDown,
			})}
			slotStart={<span data-testid="start" />}
			clearable
			clearLabel="Clear filter"
			onClear={() =>
			{
				setValue("");
				onClear();
			}}
		/>
	);
}

describe("TextInput", () =>
{
	it("draws upstream's slot-form shell with pe-md and no Clear while empty", () =>
	{
		render(<Filter />);
		const input = screen.getByRole(
			"textbox",
			{
				name: "Filter files",
			},
		);
		const shell = input.parentElement;
		expect(
			{
				cds: shell?.getAttribute("data-cds"),
				classes: shell?.className.split(" "),
				start: input.previousElementSibling?.className,
				input: input.className,
				type: input.getAttribute("type"),
				clear: screen.queryByRole("button"),
				endSlot: shell?.querySelector("[data-cds-end-slot]"),
			},
		).toStrictEqual(
			{
				cds: "TextInput",
				classes: [...SHELL, "pe-md", ...TAIL],
				start: "flex shrink-0 items-center text-secondary",
				input: "cds-input cds-reset min-w-0 flex-1 h-full bg-transparent border-0 p-0 outline-none focus-visible:outline-hidden text-body font-normal text-primary focus-visible:shadow-none placeholder:text-ink-muted disabled:opacity-100",
				type: null,
				clear: null,
				endSlot: null,
			},
		);
	});

	it("shows a nested, untabbable Clear in the end slot once there is a value", () =>
	{
		render(<Filter initial="a" />);
		const input = screen.getByRole(
			"textbox",
			{
				name: "Filter files",
			},
		);
		const clear = screen.getByRole(
			"button",
			{
				name: "Clear filter",
			},
		);
		expect(
			{
				shell: input.parentElement?.className.split(" "),
				endSlot: clear.parentElement?.className,
				endSlotAttr: clear.parentElement?.getAttribute("data-cds-end-slot"),
				clear:
				{
					tabIndex: clear.tabIndex,
					type: clear.getAttribute("type"),
					cds: clear.getAttribute("data-cds"),
					ghost: clear.getAttribute("data-cds-ghost"),
					iconOnly: clear.getAttribute("data-cds-icon-only"),
					size: clear.getAttribute("data-size"),
					className: clear.className,
				},
			},
		).toStrictEqual(
			{
				shell: [...SHELL, NESTED_PE, ...TAIL],
				endSlot:
					"flex shrink-0 items-center gap-[var(--cds-pad-sm,6px)] text-secondary [--fh:var(--cds-h-control)] [--fr:var(--upstream-radius)] [--fhn:var(--cds-h-control-nested)] [&_[data-cds=Button]:not([data-cds-ghost])]:h-[var(--fhn)] [&_[data-cds=Button]:not([data-cds-ghost])]:rounded-[calc(var(--fr)-(var(--fh)-var(--fhn))/2)] [&_[data-cds=Button][data-cds-icon-only]:not([data-cds-ghost])]:w-[var(--fhn)]",
				endSlotAttr: "",
				clear:
				{
					tabIndex: -1,
					type: "button",
					cds: "Button",
					ghost: "",
					iconOnly: "",
					size: "sm",
					className:
						"flex shrink-0 items-center justify-center size-[var(--fhn)] rounded-[calc(var(--fr)-(var(--fh)-var(--fhn))/2)] text-primary hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
				},
			},
		);
	});

	it("keeps focus in the input: Clear's mousedown is prevented and its click clears and refocuses", () =>
	{
		const onClear = vi.fn<() => void>();
		render(<Filter initial="a" onClear={onClear} />);
		const input = screen.getByRole(
			"textbox",
			{
				name: "Filter files",
			},
		);
		const clear = screen.getByRole(
			"button",
			{
				name: "Clear filter",
			},
		);
		const mouseDownAllowed = fireEvent.mouseDown(clear);
		fireEvent.click(clear);
		expect(
			{
				mouseDownAllowed,
				cleared: onClear.mock.calls.length,
				value: (input as HTMLInputElement).value,
				focused: document.activeElement === input,
				clear: screen.queryByRole("button"),
			},
		).toStrictEqual(
			{
				mouseDownAllowed: false,
				cleared: 1,
				value: "",
				focused: true,
				clear: null,
			},
		);
	});

	it("focuses the input on a mousedown anywhere on the shell", () =>
	{
		render(<Filter />);
		const input = screen.getByRole(
			"textbox",
			{
				name: "Filter files",
			},
		);
		const allowed = fireEvent.mouseDown(screen.getByTestId("start"));
		expect(
			{
				allowed,
				focused: document.activeElement === input,
			},
		).toStrictEqual(
			{
				allowed: false,
				focused: true,
			},
		);
	});

	it("clears on Escape after the consumer's handler, and stops the key, unless the consumer prevented it", () =>
	{
		const onClear = vi.fn<() => void>();
		const parent = vi.fn<() => void>();
		const {unmount} = render(
			// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- a bubbling spy
			<div onKeyDown={parent}>
				<Filter initial="a" onClear={onClear} />
			</div>,
		);
		const shifted = fireEvent.keyDown(
			screen.getByRole("textbox"),
			{
				key: "Escape",
				shiftKey: true,
			},
		);
		const afterShift = onClear.mock.calls.length;
		const notPrevented = fireEvent.keyDown(
			screen.getByRole("textbox"),
			{
				key: "Escape",
			},
		);
		const first =
		{
			shifted,
			afterShift,
			notPrevented,
			cleared: onClear.mock.calls.length,
			bubbled: parent.mock.calls.length,
		};
		unmount();

		const prevented = vi.fn<() => void>();
		render(
			<Filter
				initial="a"
				onClear={prevented}
				onKeyDown={(event) =>
				{
					event.preventDefault();
				}}
			/>,
		);
		fireEvent.keyDown(
			screen.getByRole("textbox"),
			{
				key: "Escape",
			},
		);
		expect(
			{
				first,
				consumerPrevented: prevented.mock.calls.length,
			},
		).toStrictEqual(
			{
				// Shift+Escape is not a clear; the shift keydown still bubbles to the parent.
				first:
				{
					shifted: true,
					afterShift: 0,
					notPrevented: false,
					cleared: 1,
					bubbled: 1,
				},
				consumerPrevented: 0,
			},
		);
	});

	it("keeps a Clear that is always offered, tabbable while there is nothing to clear", () =>
	{
		render(
			<TextInput
				aria-label="Search"
				value=""
				onChange={() =>
				{
				}}
				clearable="always"
				onClear={() =>
				{
				}}
			/>,
		);
		const clear = screen.getByRole(
			"button",
			{
				name: "Clear",
			},
		);
		expect(
			{
				tabIndex: clear.tabIndex,
				pe: screen.getByRole("textbox").parentElement?.className.split(" ").includes(NESTED_PE),
			},
		).toStrictEqual(
			{
				tabIndex: 0,
				pe: true,
			},
		);
	});

	it("drops w-full when the consumer sets a width, as upstream's class merge does", () =>
	{
		render(<TextInput aria-label="Search" slotStart={<span />} className="w-64" />);
		const classes = screen.getByRole("textbox").parentElement?.className.split(" ") ?? [];
		expect(
			{
				wFull: classes.includes("w-full"),
				last: classes.at(-1),
			},
		).toStrictEqual(
			{
				wFull: false,
				last: "w-64",
			},
		);
	});

	it("marks the shell, the input and the Field invalid inside an invalid Field", () =>
	{
		render(
			<Field invalid className="min-w-0 flex-1">
				<TextInput
					aria-label="Filter files"
					value="("
					onChange={() =>
					{
					}}
					slotStart={<span />}
				/>
			</Field>,
		);
		const input = screen.getByRole("textbox");
		const field = input.closest("[data-cds=Field]");
		expect(
			{
				field:
				{
					tag: field?.tagName,
					className: field?.className,
					invalid: field?.getAttribute("data-invalid"),
					filled: field?.getAttribute("data-filled"),
				},
				shell: input.parentElement?.getAttribute("data-invalid"),
				ariaInvalid: input.getAttribute("aria-invalid"),
			},
		).toStrictEqual(
			{
				field:
				{
					tag: "DIV",
					className: "flex flex-col gap-xs font-sans min-w-0 flex-1",
					invalid: "",
					filled: "",
				},
				shell: "",
				ariaInvalid: "true",
			},
		);
	});

	it("wires the input to upstream's Base UI Field.Root: filled, focused and touched track the control", () =>
	{
		render(
			<Field>
				<Filter />
			</Field>,
		);
		const input = screen.getByRole(
			"textbox",
			{
				name: "Filter files",
			},
		);
		const field = input.closest("[data-cds=Field]");
		const read = () => (
		{
			filled: field?.hasAttribute("data-filled"),
			focused: field?.hasAttribute("data-focused"),
			touched: field?.hasAttribute("data-touched"),
		});
		const empty = read();
		fireEvent.focus(input);
		fireEvent.change(
			input,
			{
				target:
				{
					value: "src",
				},
			},
		);
		const typing = read();
		fireEvent.blur(input);
		expect(
			{
				empty,
				typing,
				blurred: read(),
				hasId: input.id !== "",
			},
		).toStrictEqual(
			{
				empty:
				{
					filled: false,
					focused: false,
					touched: false,
				},
				typing:
				{
					filled: true,
					focused: true,
					touched: false,
				},
				blurred:
				{
					filled: true,
					focused: false,
					touched: true,
				},
				hasId: true,
			},
		);
	});

	it("disables the input and drops Clear inside a disabled Field", () =>
	{
		render(
			<Field disabled>
				<Filter initial="a" />
			</Field>,
		);
		const input = screen.getByRole(
			"textbox",
			{
				name: "Filter files",
			},
		);
		expect(
			{
				disabled: (input as HTMLInputElement).disabled,
				clear: screen.queryByRole("button"),
				cursor: input.parentElement?.className.split(" ").includes("cursor-default"),
			},
		).toStrictEqual(
			{
				disabled: true,
				clear: null,
				cursor: true,
			},
		);
	});

	it("marks a sized TextInput with data-size and nests an xs Clear under sm, as upstream's size prop does", () =>
	{
		const {unmount} = render(
			<TextInput
				aria-label="Search"
				size="sm"
				value="a"
				onChange={() =>
				{
				}}
				clearable
				onClear={() =>
				{
				}}
			/>,
		);
		const sm =
		{
			shell: screen.getByRole("textbox").parentElement?.getAttribute("data-size"),
			clear: screen
				.getByRole(
					"button",
					{
						name: "Clear",
					},
				)
				.getAttribute("data-size"),
		};
		unmount();
		const base = render(<TextInput aria-label="Search" size="base" />);
		const bareBase = screen.getByRole("textbox").getAttribute("data-size");
		base.unmount();
		render(<TextInput aria-label="Search" size="lg" />);
		expect(
			{
				sm,
				bareBase,
				bareLg: screen.getByRole("textbox").getAttribute("data-size"),
			},
		).toStrictEqual(
			{
				sm:
				{
					shell: "sm",
					clear: "xs",
				},
				bareBase: null,
				bareLg: "lg",
			},
		);
	});

	it("leaves the width to the consumer when fullWidth is off", () =>
	{
		const {unmount} = render(<TextInput aria-label="Search" slotStart={<span />} fullWidth={false} />);
		const slot = screen.getByRole("textbox").parentElement?.className.split(" ") ?? [];
		unmount();
		render(<TextInput aria-label="Search" fullWidth={false} />);
		const bare = screen.getByRole("textbox").className.split(" ");
		expect(
			{
				slot:
				{
					wFull: slot.includes("w-full"),
					minW0: slot.includes("min-w-0"),
				},
				bare: bare.includes("w-full"),
			},
		).toStrictEqual(
			{
				slot:
				{
					wFull: false,
					minW0: false,
				},
				bare: false,
			},
		);
	});

	it("renders the bare form as one input carrying the shell when there are no slots", () =>
	{
		render(<TextInput aria-label="Name" />);
		const input = screen.getByRole("textbox");
		expect(
			{
				cds: input.getAttribute("data-cds"),
				classes: input.className.split(" "),
			},
		).toStrictEqual(
			{
				cds: "TextInput",
				classes: [
					"cds-input",
					"cds-reset",
					...SHELL,
					"pe-md",
					"w-full",
					"placeholder:text-ink-muted",
					"outline-none",
					"focus-visible:outline-hidden",
					"enabled:[&:hover:not(:focus):not([data-invalid])]:shadow-field-hover",
					"disabled:opacity-disabled",
					"focus-visible:shadow-focus",
					"data-[invalid]:focus-visible:shadow-focus-danger",
				],
			},
		);
	});
});
