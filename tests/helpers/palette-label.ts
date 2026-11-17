/**
 * Matches a palette option by its visible label text. dom-accessibility-api trims each element's
 * text, so highlight runs like "Settings → " + "Code" compute as "Settings →Code" in jsdom,
 * unlike in browsers.
 */
export function byLabel(label: string | RegExp)
{
	return {
		name: (_name: string, element: Element) =>
		{
			const text = element.querySelector("[data-palette-label]")?.textContent ?? "";
			return typeof label === "string" ? text === label : label.test(text);
		},
	};
}
