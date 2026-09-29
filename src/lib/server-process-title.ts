export const SERVER_PROCESS_TITLE = "claude-code-browser-server";

// scripts/server.sh finds the production server by this title (SERVER_TITLE),
// so keep the two in sync. Dev mode keeps the Vite process's own title.
export function setServerProcessTitle({ dev }: { dev: boolean }): void {
  if (!dev) {
    process.title = SERVER_PROCESS_TITLE;
  }
}
