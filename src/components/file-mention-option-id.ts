export function fileMentionOptionId(menuId: string, index: number): string
{
	return `${menuId}-option-${index}`;
}

/** The positioned popup around the mention listbox `menuId`: the composer anchors it to the `@` glyph. */
export function mentionPopupId(menuId: string): string
{
	return `${menuId}-popup`;
}
