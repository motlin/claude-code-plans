function isHidden(element: HTMLElement): boolean
{
	if (element.hidden || element.style.display === "none") return true;
	return element.parentElement !== null && isHidden(element.parentElement);
}

/**
 * jsdom never lays out, so `offsetWidth` is always 0. The file column hook reads the column's
 * `offsetWidth` to commit a drag, so this derives it from the inline `style.width` (0 while the
 * element or an ancestor is `display:none` or `hidden`), the way a browser would within 160–640.
 * Returns a function that puts the real getter back.
 */
export function stubColumnLayout(): () => void
{
	const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
	Object.defineProperty(
		HTMLElement.prototype,
		"offsetWidth",
		{
			configurable: true,
			get(this: HTMLElement): number
			{
				if (isHidden(this)) return 0;
				const width = Number.parseFloat(this.style.width);
				return Number.isFinite(width) ? width : 0;
			},
		},
	);
	return () =>
	{
		if (original === undefined)
		{
			Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
		}
		else
		{
			Object.defineProperty(HTMLElement.prototype, "offsetWidth", original);
		}
	};
}
