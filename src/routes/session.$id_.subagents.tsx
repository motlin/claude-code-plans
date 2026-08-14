import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, GitFork } from "lucide-react";
import { sessionSubagentsQueryOptions } from "../lib/api/sessions";
import { SubagentGantt } from "../components/subagent-gantt";
import { SubagentSequence } from "../components/subagent-sequence";
import { SubagentTree } from "../components/subagent-tree";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";
import { useSettings } from "../components/settings-provider";
import { useClaudeEvents } from "../hooks/use-claude-events";
import { toSubagentSessionId } from "../lib/subagents";

export const Route = createFileRoute("/session/$id_/subagents")({
  component: SubagentsPage,
  loader: async ({ context: { queryClient }, params }) => {
    await queryClient.ensureQueryData(sessionSubagentsQueryOptions(params.id));
  },
  head: ({ params }) => ({
    meta: [{ title: `Subagents - ${params.id.slice(0, 8)}` }],
  }),
});

function SubagentsPage() {
  const params = Route.useParams();
  const { data: agents } = useSuspenseQuery(sessionSubagentsQueryOptions(params.id));
  const { settings } = useSettings();
  const subagentView = settings.defaultSubagentView;
  const { liveSubagents } = useClaudeEvents();
  const subagentCount = new Set([
    ...agents.map((agent) => toSubagentSessionId(agent.id)),
    ...[...liveSubagents.values()]
      .filter((node) => node.sessionId === params.id)
      .map((node) => node.agentId),
  ]).size;

  return (
    <div>
      <DetailTopBar>
        <Link to="/session/$id" params={{ id: params.id }} className={pillStyles.primary}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to session
        </Link>
      </DetailTopBar>

      <h1 className="text-lg font-semibold flex items-center gap-2">
        <GitFork className="h-4 w-4 text-t6" />
        Subagents ({subagentCount})
      </h1>

      {subagentView === "tree" ? (
        <div className="mt-3">
          <SubagentTree agents={agents} sessionId={params.id} />
        </div>
      ) : agents.length === 0 ? (
        <p className="mt-4 text-sm text-t6">No subagents for this session.</p>
      ) : (
        <div className="mt-3">
          {subagentView === "sequence" ? (
            <SubagentSequence agents={agents} />
          ) : (
            <SubagentGantt agents={agents} />
          )}
        </div>
      )}
    </div>
  );
}
