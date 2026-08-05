import { join } from "node:path";

/**
 * Resolve the JSON API socket used by a release build of herdr.
 *
 * `herdr-client.sock` is a different socket that speaks bincode for the TUI
 * and must never be used for API requests. Debug builds also use the config
 * directory name `herdr-dev` instead of `herdr`.
 */
export function resolveHerdrSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicitSocketPath = env["HERDR_SOCKET_PATH"];
  if (explicitSocketPath) return explicitSocketPath;

  const xdgConfigHome = env["XDG_CONFIG_HOME"];
  const home = env["HOME"];
  let configHome: string;
  if (xdgConfigHome) {
    configHome = xdgConfigHome;
  } else if (home) {
    configHome = join(home, ".config");
  } else {
    throw new Error("HOME must be set when XDG_CONFIG_HOME is unavailable");
  }

  const configDir = join(configHome, "herdr");
  const sessionName = env["HERDR_SESSION"];
  if (sessionName && sessionName !== "default") {
    return join(configDir, "sessions", sessionName, "herdr.sock");
  }

  return join(configDir, "herdr.sock");
}
