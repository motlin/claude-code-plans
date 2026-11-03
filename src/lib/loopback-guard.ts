const LOOPBACK_ADDRESS = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/i;

export function isLoopbackAddress(address: string): boolean {
	return LOOPBACK_ADDRESS.test(address.trim());
}

/** The crossws `open` check, where the peer address is always known (`vp dev` upgrades omit `request.ip`, so the middleware lets them through): a missing one fails closed. */
export function isLoopbackPeer(address: string | undefined): boolean {
	return address !== undefined && isLoopbackAddress(address);
}

export const LOCAL_ONLY_CLOSE_REASON = "server is local only";

const LOCAL_ONLY = "This server only answers requests from this computer";

/**
 * The server-wide gate: only a loopback TCP peer is served. Production listens on every interface because one socket
 * cannot bind both 127.0.0.1 (Caddy's upstream) and [::1] (local browsers), so the peer address is what keeps LAN hosts
 * out. Forwarded headers are deliberately ignored: Caddy connects from loopback and passes remote clients' addresses
 * in X-Forwarded-For, and those requests must still be served. `ip` is srvx's `request.ip`, the socket's remote
 * address while no trustProxy is configured. `allowMissing` admits a request with no address, which only the
 * loopback-bound dev server's worker hop produces.
 */
export function rejectNonLoopbackPeer(ip: unknown, options: {allowMissing: boolean}): Response | null {
	const allowed = typeof ip === "string" ? isLoopbackAddress(ip) : ip === undefined && options.allowMissing;
	return allowed ? null : Response.json({error: LOCAL_ONLY}, {status: 403});
}
