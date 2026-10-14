const BRIDGE_ALIAS = /^session_[A-Za-z0-9_-]+$/;
// The leading 8 hex digits of a session UUID, optionally continued, but never the whole UUID.
const SESSION_ID_PREFIX = /^[0-9a-f]{8}(?:-[0-9a-f-]{0,26})?$/;

/** A Remote Control `session_…` URL; its local owner comes from the bridge index. */
export function isBridgeSessionAlias(routeId: string): boolean {
	return BRIDGE_ALIAS.test(routeId);
}

/** A short session UUID prefix such as `6473581f`; its owner is the one indexed session it starts. */
export function isSessionIdPrefix(routeId: string): boolean {
	return SESSION_ID_PREFIX.test(routeId);
}

/**
 * A session route ID that is not itself a local session ID, so it resolves to one through
 * `/api/sessions/$id/identity` before any query or SSE subscription is keyed by it.
 */
export function isSessionRouteAlias(routeId: string): boolean {
	return routeId.startsWith("session_") || isSessionIdPrefix(routeId);
}
