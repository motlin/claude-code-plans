type ShutdownHook = () => void | Promise<void>;

// Nitro plugins and the SSR entry (src/server.ts) are bundled separately, so
// each gets its own copy of this module. The registry lives on globalThis so
// hooks registered by the SSR entry run from the Nitro plugin's close hook.
const REGISTRY = Symbol.for("claude-code-browser.server-shutdown-hooks");

function hooks(): Set<ShutdownHook> {
  const holder = globalThis as { [REGISTRY]?: Set<ShutdownHook> };
  return (holder[REGISTRY] ??= new Set());
}

/** Register cleanup that releases a long-lived handle when the server shuts down. */
export function onServerShutdown(hook: ShutdownHook): () => void {
  hooks().add(hook);
  return () => {
    hooks().delete(hook);
  };
}

/** Run and forget every registered hook; a failing hook never skips the others. */
export async function runServerShutdownHooks(): Promise<void> {
  const pending = [...hooks()];
  hooks().clear();
  const results = await Promise.allSettled(pending.map(async (hook) => hook()));
  for (const result of results) {
    if (result.status === "rejected") console.error("Server shutdown hook failed:", result.reason);
  }
}
