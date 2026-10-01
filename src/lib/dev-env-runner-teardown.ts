// In dev, nitro runs the whole server app (watcher, indexer, timers, SSE) in an env-runner worker thread that listens
// on its own ephemeral loopback port. A vite restart (vite.config.ts or one of its imports changing) loads the config
// again, so nitro creates a fresh runner, but nothing ever closes the previous one: nitro only closes its runner from a
// nitro `close` hook that vite never calls. Each restart therefore stranded a complete copy of the app, still
// watching and re-indexing every transcript, still holding its port, heap and file descriptors.

interface ClosableRunner {
	close(): Promise<void>;
}

interface DevServerLike {
	environments: Record<string, {devServer?: unknown} | undefined>;
}

interface DevPlugin {
	name: string;
	apply: "serve";
	configureServer(server: DevServerLike): void;
	closeServer(): Promise<void>;
}

function isClosableRunner(value: unknown): value is ClosableRunner {
	return value !== null && typeof value === "object" && "close" in value && typeof value.close === "function";
}

/** Closes the nitro env runner (and so terminates its worker) when the vite dev server that owns it closes. */
export function closeNitroRunnerOnServerClose(): DevPlugin {
	const runners: ClosableRunner[] = [];
	return {
		name: "ccp:close-nitro-env-runner",
		apply: "serve",
		configureServer(server) {
			const runner = server.environments["nitro"]?.devServer;
			if (isClosableRunner(runner)) runners.push(runner);
		},
		async closeServer() {
			// Servers close in the order they were configured; a restart configures the new one first.
			const runner = runners.shift();
			if (runner === undefined || runners.includes(runner)) return;
			await runner.close();
		},
	};
}
