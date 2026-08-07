import { createFileRoute } from "@tanstack/react-router";
import { SessionDetailResponse } from "../../lib/api/sessions";

export const Route = createFileRoute("/api/sessions/$id")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const { getDb } = await import("../../lib/db");
        const {
          getSessionProjectPath,
          getSessionMeta,
          getTaskCountsForProject,
          getSubagentById,
          isSessionStarred,
        } = await import("../../lib/db/queries");
        const { sessions } = await import("../../lib/db/schema");
        const { eq } = await import("drizzle-orm");
        const { getSummary } = await import("../../lib/summaries");
        const { getCurrentSessionMessageIndex, getSessionViewedState } =
          await import("../../lib/db/viewed-state");
        const { readSession } = await import("../../lib/sessions");
        const { readConfig } = await import("../../lib/config");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");

        const homeRoot = homedir();
        const imageRoots = readConfig()?.image_roots ?? [];
        const PROJECTS_DIR = join(homeRoot, ".claude", "projects");

        const { id } = params;
        const { index, summaries } = getDb();

        const sessionRow = index
          .select({
            title: sessions.title,
            customTitle: sessions.customTitle,
            projectId: sessions.projectId,
          })
          .from(sessions)
          .where(eq(sessions.id, id))
          .get();

        if (!sessionRow) {
          const subagent = getSubagentById(index, id);
          if (!subagent) {
            return Response.json(SessionDetailResponse.parse(null), {
              headers: {
                "Cache-Control": "private, max-age=0, must-revalidate",
              },
            });
          }

          const parentSessionProjectPath = getSessionProjectPath(index, subagent.sessionId);
          const detail: NonNullable<ReturnType<typeof SessionDetailResponse.parse>> = {
            title: subagent.description ?? subagent.slug ?? id,
            projectName: subagent.projectId,
            projectId: subagent.projectId,
            homeRoot,
            imageRoots,
            starred: false,
            summary: null,
            projectPath: parentSessionProjectPath,
            gitBranch: null,
            cwd: null,
            gitSha: null,
            gitClean: null,
            messageCount: 0,
            pendingTaskCount: 0,
            viewedState: getSessionViewedState(index, id, -1),
            parentSessionId: subagent.sessionId,
          };
          return Response.json(SessionDetailResponse.parse(detail), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }

        const projectPath = getSessionProjectPath(index, id);
        const sessionMeta = getSessionMeta(index, id);

        let pendingTaskCount = 0;
        if (sessionMeta) {
          const taskCounts = getTaskCountsForProject(index, sessionRow.projectId);
          pendingTaskCount = taskCounts.pending + taskCounts.inProgress;
        }

        let gitSha: string | null = null;
        let gitClean: boolean | null = null;
        if (projectPath) {
          try {
            const { execSync } = await import("node:child_process");
            const execOpts = {
              cwd: projectPath,
              encoding: "utf-8" as const,
              stdio: "pipe" as const,
            };
            gitSha = execSync("git rev-parse --short HEAD", execOpts).trim();
            const status = execSync("git status --porcelain", execOpts).trim();
            gitClean = status.length === 0;
          } catch {
            // not a git repo or git not available
          }
        }

        const starred = isSessionStarred(index, id);
        const summary = getSummary(summaries, id);

        const detail: NonNullable<ReturnType<typeof SessionDetailResponse.parse>> = {
          title: sessionRow.customTitle ?? sessionRow.title,
          projectName: sessionMeta?.projectName ?? sessionRow.projectId,
          projectId: sessionRow.projectId,
          homeRoot,
          imageRoots,
          starred,
          summary,
          projectPath,
          gitBranch: sessionMeta?.gitBranch ?? null,
          cwd: sessionMeta?.cwd ?? null,
          gitSha,
          gitClean,
          messageCount: sessionMeta?.messageCount ?? 0,
          pendingTaskCount,
          viewedState: getSessionViewedState(index, id, getCurrentSessionMessageIndex(index, id)),
        };

        const provenance = await readSession(PROJECTS_DIR, id);
        if (provenance) {
          if (detail.messageCount === 0) detail.messageCount = provenance.messageCount;
          if (provenance.entrypoint !== undefined) detail.entrypoint = provenance.entrypoint;
          if (provenance.sessionKind !== undefined) detail.sessionKind = provenance.sessionKind;
          if (provenance.teamNames !== undefined) detail.teamNames = provenance.teamNames;
          if (provenance.forkedFromSessionId !== undefined)
            detail.forkedFromSessionId = provenance.forkedFromSessionId;
        }

        return Response.json(SessionDetailResponse.parse(detail), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
