/** The page title HeadContent rendered from the routes' `pageTitle` meta; the tab title is always "Claude Code". */
export function renderedPageTitle(): string {
	return document.querySelector('meta[name="ccb-page-title"]')?.getAttribute("content") ?? "";
}
