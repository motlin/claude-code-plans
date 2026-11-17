/**
 * Keys typed while the palette module downloads (upstream shared-100 `nI`/`HQ`/`pS`/`Sw`): the loading shell
 * appends printable keys and Backspace here, and the palette opens on them as the opening view's text.
 */
let text = "";

export function appendPaletteKey(key: string): void
{
	text += key;
}

export function backspacePaletteKey(): void
{
	text = text.slice(0, -1);
}

export function readPaletteKeys(): string
{
	return text;
}

export function clearPaletteKeys(): void
{
	text = "";
}
