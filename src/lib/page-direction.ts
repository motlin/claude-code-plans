/** Upstream `p() === "rtl"`: the page's direction, read off the root element. */
export function pageIsRtl(): boolean {
	return document.documentElement.dir === "rtl";
}
