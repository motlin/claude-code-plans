/** The shell commands that resume or fork a session from its project directory. */
export function createSessionCommands(sessionId: string, projectPath: string | null) {
  const directoryPrefix = projectPath === null ? "" : `cd '${projectPath}' && `;
  const resumeCommand = `${directoryPrefix}claude -r ${sessionId}`;

  return {
    resume: resumeCommand,
    fork: `${resumeCommand} --fork-session`,
  };
}
