/**
 * An element's inline declarations as `name: value;` longhands, in the order they were set. jsdom folds longhands
 * into shorthands no browser has (`min-size`, `border-block-start-radius`) when it serializes the `style` attribute,
 * so read each longhand instead.
 */
export function longhandStyle(element: Element | null | undefined): string | undefined
{
	if (!(element instanceof HTMLElement)) return undefined;
	const {style} = element;
	return [...style].map((name) => `${name}: ${style.getPropertyValue(name)};`).join(" ");
}
