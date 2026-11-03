import {defineMiddleware} from "nitro";
import {rejectNonLoopbackPeer} from "../../src/lib/loopback-guard";

/**
 * Runs before every route, the TanStack app and WebSocket upgrades alike: LAN peers get a 403. Nitro resolves an
 * upgrade's crossws hooks from this response, and a bare 403 resolves to none, which crossws would still upgrade, so
 * the rejection carries an `upgrade` hook that refuses it.
 */
export default defineMiddleware((event) => {
	const rejection = rejectNonLoopbackPeer(event.req.ip, {allowMissing: import.meta.dev === true});
	if (rejection === null) return undefined;
	return Object.assign(rejection, {crossws: {upgrade: () => rejection.clone()}});
});
