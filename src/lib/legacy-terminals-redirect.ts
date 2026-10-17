import {redirect} from "@tanstack/react-router";

export interface LegacyLocation {
	pathname: string;
	searchStr: string;
	hash: string;
}

/** The live terminal page used to sit under a `/terminal` segment: `/terminals/terminal/$sessionId`. */
const LEGACY_TERMINAL_SEGMENT = "/terminal/";

/**
 * The `/terminals` path a legacy `prefix` URL now lives at, keeping its subpath, search and hash. A live terminal
 * page's retired `/terminal/$sessionId` subpath becomes `/$sessionId`.
 */
function terminalsHrefForLegacy(
	prefix: "/herdr" | "/tmux" | "/terminals",
	{pathname, searchStr, hash}: LegacyLocation,
): string {
	const afterPrefix = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
	const rest = afterPrefix.startsWith(LEGACY_TERMINAL_SEGMENT)
		? afterPrefix.slice(LEGACY_TERMINAL_SEGMENT.length - 1)
		: afterPrefix;
	return `/terminals${rest === "/" ? "" : rest}${searchStr}${hash === "" ? "" : `#${hash}`}`;
}

/** A `beforeLoad` that sends a retired section's links and bookmarks to the same view under Terminals. */
export function legacyTerminalsRedirect(prefix: "/herdr" | "/tmux") {
	return ({location}: {location: LegacyLocation}): never => {
		throw redirect({href: terminalsHrefForLegacy(prefix, location), replace: true});
	};
}

/** A `beforeLoad` that sends `/terminals/terminal/$sessionId` to the live terminal page at `/terminals/$sessionId`. */
export const legacyTerminalPageRedirect = ({location}: {location: LegacyLocation}): never => {
	throw redirect({href: terminalsHrefForLegacy("/terminals", location), replace: true});
};
