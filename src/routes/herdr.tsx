import {createFileRoute, redirect} from "@tanstack/react-router";

/** The `/terminals` path a legacy `/herdr` URL now lives at, keeping its search and hash. */
function terminalsHrefForLegacyHerdr({
	pathname,
	searchStr,
	hash,
}: {
	pathname: string;
	searchStr: string;
	hash: string;
}): string {
	const rest = pathname.replace(/^\/herdr(?=\/|$)/, "");
	return `/terminals${rest}${searchStr}${hash === "" ? "" : `#${hash}`}`;
}

/** The Herdr section became Terminals; old links and bookmarks land on the same view there. */
export function redirectLegacyHerdr({
	location,
}: {
	location: {pathname: string; searchStr: string; hash: string};
}): never {
	throw redirect({href: terminalsHrefForLegacyHerdr(location), replace: true});
}

export const Route = createFileRoute("/herdr")({
	beforeLoad: redirectLegacyHerdr,
});
