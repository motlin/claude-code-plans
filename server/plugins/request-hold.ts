import {definePlugin} from "nitro";
import {expectRequestHold} from "../../src/lib/server-shutdown";

// In dev the SSR entry loads eagerly, but WebSocket upgrades skip the dev server's request gate, so one can reach
// the socket routes before the entry sets its takeover hold. Production loads the SSR entry lazily on the first
// HTTP request and has no previous instance in-process to take over from, so holding there would only stall
// sockets until some page request arrives.
export default definePlugin(() =>
{
	if (import.meta.dev === true) expectRequestHold();
});
