/** The emoji popup's option ids, kept off the lazy menu chunk so the composer can point aria-activedescendant at them. */
export function emojiOptionId(menuId: string, index: number): string
{
	return `${menuId}-option-${index}`;
}
