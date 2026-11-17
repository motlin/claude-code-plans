import {z} from "zod";

/*
 * The /api/output-styles wire shape and upstream's Output style select items, kept free of
 * server-only imports so the Settings dialog can use them.
 */

export const OutputStylesSchema = z.strictObject(
	{
		builtIns: z.array(z.string()),
		customs: z.array(z.string()),
	},
);
export type OutputStyles = z.infer<typeof OutputStylesSchema>;

export interface OutputStyleOption
{
	value: string;
	label: string;
	disabled?: true;
}

/** settings.json without `outputStyle` (or with "default" in any case) means the CLI's default style. */
export const DEFAULT_OUTPUT_STYLE = "";

/**
 * Upstream's items: Default, then the built-ins and customs deduplicated case-insensitively
 * ("default" collapses into Default). A current value that isn't installed is appended disabled so the
 * trigger still names it.
 */
export function outputStyleOptions(
	styles: OutputStyles | undefined,
	current: string,
):
{
	value: string;
	options: OutputStyleOption[];
}
{
	const value = current.toLowerCase() === "default" ? DEFAULT_OUTPUT_STYLE : current;
	const options: OutputStyleOption[] = [
		{
			value: DEFAULT_OUTPUT_STYLE,
			label: "Default",
		},
	];
	const seen = new Set(["default"]);
	for (const name of [...(styles?.builtIns ?? []), ...(styles?.customs ?? [])])
	{
		const folded = name.toLowerCase();
		if (name.length === 0 || seen.has(folded)) continue;
		seen.add(folded);
		options.push(
			{
				value: name,
				label: name,
			},
		);
	}
	if (value !== DEFAULT_OUTPUT_STYLE && !options.some((option) => option.value === value))
	{
		options.push(
			{
				value,
				label: value,
				disabled: true,
			},
		);
	}
	return {
		value,
		options,
	};
}

/** One style in the session `/output-style` picker (upstream `KH`'s items without the callbacks). */
export interface OutputStyleItem
{
	name: string;
	label: string;
	checked: boolean;
}

/** The CLI's name for its default style. */
const CLI_DEFAULT_OUTPUT_STYLE = "default";

/**
 * Upstream `KH`/`GH` for a session: "default", then the built-ins and customs deduplicated case-insensitively,
 * labelled by name except "default" ("Default" unless another style already has that label), checked when it is
 * the session's style (the CLI's default when unknown). Undefined until the styles load.
 */
export function outputStyleItems(
	styles: OutputStyles | undefined,
	current: string | undefined,
): OutputStyleItem[] | undefined
{
	if (styles === undefined) return undefined;
	const names: string[] = [];
	const seen = new Set<string>();
	for (const name of [CLI_DEFAULT_OUTPUT_STYLE, ...styles.builtIns, ...styles.customs])
	{
		const folded = name.toLowerCase();
		if (name.length === 0 || seen.has(folded)) continue;
		seen.add(folded);
		names.push(name);
	}
	const selected = (current ?? CLI_DEFAULT_OUTPUT_STYLE).toLowerCase();
	const defaultTaken = names.some((name) => name !== CLI_DEFAULT_OUTPUT_STYLE && name.toLowerCase() === "default");
	return names.map((name) => (
	{
		name,
		label: name === CLI_DEFAULT_OUTPUT_STYLE && !defaultTaken ? "Default" : name,
		checked: name.toLowerCase() === selected,
	}));
}
