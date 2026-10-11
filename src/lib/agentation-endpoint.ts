// Same-origin path the dev server proxies to the local Agentation server, so the toolbar
// works when the app is opened through another host (e.g. an https reverse proxy) where
// the browser's own localhost:4747 is unreachable or blocked as mixed content.
export const AGENTATION_ENDPOINT = "/__agentation";
export const AGENTATION_SERVER = "http://localhost:4747";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where the toolbar should connect from a page at `location`. A plain-http loopback page reaches
 * the server directly: the toolbar holds an event stream open, and through the proxy that stream
 * would count against the six HTTP/1.1 connections Chrome allows the app's origin, alongside each
 * tab's /api/events -- three tabs then leave none for the app's own fetches.
 */
export function agentationEndpoint(location: Pick<URL, "protocol" | "hostname">): string {
	return location.protocol === "http:" && LOOPBACK_HOSTNAMES.has(location.hostname)
		? AGENTATION_SERVER
		: AGENTATION_ENDPOINT;
}
