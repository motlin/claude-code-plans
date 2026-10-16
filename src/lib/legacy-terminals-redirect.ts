import {redirect} from "@tanstack/react-router";

export interface LegacyLocation {
	pathname: string;
	searchStr: string;
	hash: string;
}

/** The `/terminals` path a legacy `prefix` URL now lives at, keeping its subpath, search and hash. */
function terminalsHrefForLegacy(prefix: "/herdr" | "/tmux", {pathname, searchStr, hash}: LegacyLocation): string {
	const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
	return `/terminals${rest === "/" ? "" : rest}${searchStr}${hash === "" ? "" : `#${hash}`}`;
}

/** A `beforeLoad` that sends a retired section's links and bookmarks to the same view under Terminals. */
export function legacyTerminalsRedirect(prefix: "/herdr" | "/tmux") {
	return ({location}: {location: LegacyLocation}): never => {
		throw redirect({href: terminalsHrefForLegacy(prefix, location), replace: true});
	};
}
