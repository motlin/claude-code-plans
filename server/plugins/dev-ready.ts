import {definePlugin} from "nitro";
import {announceThisDevEnvReady} from "../../src/lib/dev-env-ready-gate";

// Plugins run once the nitro entry's imports have loaded, so this tells the dev server's request gate
// (holdNitroRequestsUntilReady in vite.config.ts) that the nitro environment can take requests.
export default definePlugin(() => {
	announceThisDevEnvReady();
});
