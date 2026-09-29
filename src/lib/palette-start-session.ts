export interface StartProject {
  id: string;
  name: string;
  projectPath: string;
}

interface ProjectCandidate {
  id: string;
  name: string;
  projectPath: string | null;
  lastActivity: string;
}

/**
 * Projects the ⌘K "New session" picker offers: the current session's project,
 * then the projects of recent sessions in feed order, then the rest by
 * activity. Projects with no directory on disk cannot host a launch.
 */
export function startSessionProjects(
  projects: readonly ProjectCandidate[],
  recentProjectIds: readonly string[],
  currentProjectId: string | undefined,
): StartProject[] {
  const launchable = projects
    .flatMap(({ id, name, projectPath, lastActivity }) =>
      projectPath === null ? [] : [{ id, name, projectPath, lastActivity }],
    )
    .sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
  const rank = new Map<string, number>();
  const leading =
    currentProjectId === undefined ? recentProjectIds : [currentProjectId, ...recentProjectIds];
  for (const id of leading) if (!rank.has(id)) rank.set(id, rank.size);
  return launchable
    .map((project, index) => ({ project, order: rank.get(project.id) ?? rank.size + index }))
    .sort((a, b) => a.order - b.order)
    .map(({ project: { id, name, projectPath } }) => ({ id, name, projectPath }));
}

export interface PendingLaunch {
  cwd: string;
  /** Client clock when the launch began; SessionStart events are stamped with the same clock. */
  since: number;
  /** The id herdr reported for the new agent, when it knew one. */
  sessionId: string | null;
}

interface StartedSession {
  sessionId: string;
  cwd: string;
  startedAt: number;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** The session a pending launch produced: herdr's id when known, else a fresh SessionStart in that cwd. */
export function findLaunchedSession(
  sessions: Iterable<StartedSession>,
  launch: PendingLaunch,
): string | null {
  const cwd = withoutTrailingSlash(launch.cwd);
  for (const session of sessions) {
    if (session.startedAt < launch.since) continue;
    if (session.sessionId === launch.sessionId || withoutTrailingSlash(session.cwd) === cwd) {
      return session.sessionId;
    }
  }
  return null;
}
