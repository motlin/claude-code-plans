// A vite restart (vite.config.ts or one of its imports changing) builds a whole new dev server, closes the old one
// and listens again. Vite guards against overlapping restarts with a promise on the server, but the server a restart
// is creating starts with that guard empty and copies it over the old one, so a second change in the same burst (a
// git checkout rewriting several config imports) starts a second restart alongside the first. The two race to close
// and listen, and the dev process dies with ERR_SERVER_ALREADY_LISTEN or "Port 7526 is already in use".
//
// Every server's restart is wrapped to go through one queue shared by all of them: a request made while a restart
// is running waits for it and then runs one more, so the server ends up on the latest config.

type Restart = (forceOptimize?: boolean) => Promise<void>;

export interface RestartQueue {
	running: Promise<void> | undefined;
	next: Promise<void> | undefined;
}

interface DevServerLike {
	restart: Restart;
}

interface DevPlugin {
	name: string;
	apply: "serve";
	configureServer(server: DevServerLike): void;
}

export function newRestartQueue(): RestartQueue {
	return {running: undefined, next: undefined};
}

// Each restart loads vite.config.ts, and so this module, afresh; the queue has to outlive those copies.
const SHARED_QUEUE = Symbol.for("ccp:dev-server-restart-queue");

function sharedRestartQueue(): RestartQueue {
	const holder = globalThis as typeof globalThis & {[SHARED_QUEUE]?: RestartQueue};
	holder[SHARED_QUEUE] ??= newRestartQueue();
	return holder[SHARED_QUEUE];
}

/** Runs `restart` one at a time on `queue`, folding every request made during a run into a single follow-up run. */
export function serializeRestarts(restart: Restart, queue: RestartQueue): Restart {
	const start = async (forceOptimize?: boolean): Promise<void> => {
		const run = restart(forceOptimize).finally(() => {
			if (queue.running === run) queue.running = undefined;
		});
		queue.running = run;
		return run;
	};
	return async (forceOptimize) => {
		const running = queue.running;
		if (running === undefined) return start(forceOptimize);
		queue.next ??= running
			.catch(() => undefined)
			.then(async () => {
				queue.next = undefined;
				return start(forceOptimize);
			});
		return queue.next;
	};
}

/** Serializes restarts of every dev server this config creates, including the ones its own restarts create. */
export function serializeDevServerRestarts(): DevPlugin {
	return {
		name: "ccp:serialize-dev-server-restarts",
		apply: "serve",
		configureServer(server) {
			server.restart = serializeRestarts(server.restart, sharedRestartQueue());
		},
	};
}
