import { z } from "zod";
import { rejectCrossSite } from "./same-origin-guard";

const OpenInFinderRequestSchema = z.object({ sessionId: z.string().min(1) }).strict();

export interface OpenInFinderDependencies {
  rejectRequest: (request: Request) => Response | null;
  /** The indexed session's own directory, or null for an unknown session. */
  resolveSessionCwd: (sessionId: string) => Promise<string | null>;
  isDirectory: (path: string) => Promise<boolean>;
  openPath: (path: string) => Promise<void>;
}

const defaultDependencies: OpenInFinderDependencies = {
  rejectRequest: rejectCrossSite,
  resolveSessionCwd: async (sessionId) => {
    const { getDb } = await import("./db");
    const { getSessionDirectory } = await import("./db/queries");
    return getSessionDirectory(getDb().index, sessionId);
  },
  isDirectory: async (path) => {
    const { stat } = await import("node:fs/promises");
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
  openPath: async (path) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("open", [path]);
  },
};

/**
 * Reveal a session's directory in Finder. The client names only the session;
 * the path always comes from the index, so no caller-chosen path is opened.
 */
export async function handleOpenInFinder(
  request: Request,
  dependencies: OpenInFinderDependencies = defaultDependencies,
): Promise<Response> {
  const rejection = dependencies.rejectRequest(request);
  if (rejection) return rejection;

  const parsed = OpenInFinderRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  const cwd = await dependencies.resolveSessionCwd(parsed.data.sessionId);
  if (cwd === null) return Response.json({ error: "Unknown session" }, { status: 404 });
  if (!(await dependencies.isDirectory(cwd))) {
    return Response.json({ error: "Session directory not found" }, { status: 404 });
  }

  await dependencies.openPath(cwd);
  return Response.json({ ok: true });
}
