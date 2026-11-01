export type FallbackShell = "artifacts" | "home" | "session";

/**
 * The shell the loaded page at `pathname` shows. The server paints from the requested path, but the
 * client hydrates after a redirect-only route's `beforeLoad` has moved it, so those routes paint
 * their target's shell: `/settings` opens the settings dialog over home. The other redirect-only
 * routes (`/plugins`, `/customize/`, `/command/…`, `/plugin/…`) land on Customize pages, which
 * share the session default.
 */
export function fallbackShellFor(pathname: string): FallbackShell {
	if (pathname === "/artifacts") return "artifacts";
	if (pathname === "/" || pathname === "/settings" || pathname === "/settings/") return "home";
	return "session";
}
