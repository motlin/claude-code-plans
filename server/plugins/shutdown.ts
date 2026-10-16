import {definePlugin} from "nitro";
import {stopAllTerminalHostStreams} from "../../src/lib/terminal-host";
import {runServerShutdownHooks} from "../../src/lib/server-shutdown";
import {stopAllShells} from "../../src/lib/shell-pty";

export default definePlugin((nitroApp) => {
	nitroApp.hooks.hook("close", stopAllTerminalHostStreams);
	nitroApp.hooks.hook("close", stopAllShells);
	nitroApp.hooks.hook("close", runServerShutdownHooks);

	// The node-server preset's SIGTERM/SIGINT handler only closes the HTTP
	// server; nothing calls the close hook, so the watcher, timers and open
	// streams kept the process alive until scripts/server.sh force-killed it.
	// Dev servers run the close hook themselves.
	if (import.meta.dev !== true) {
		const close = () => {
			void nitroApp.hooks.callHook("close");
		};
		process.once("SIGTERM", close);
		process.once("SIGINT", close);
	}
});
