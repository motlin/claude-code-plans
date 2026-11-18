export function slashCommandOptionId(menuId: string, index: number): string
{
	return `${menuId}-option-${index}`;
}

/** The id of an open submenu's nested option, for the editor's `aria-activedescendant`. */
export function slashSubmenuOptionId(menuId: string, index: number): string
{
	return slashCommandOptionId(`${menuId}-submenu`, index);
}
