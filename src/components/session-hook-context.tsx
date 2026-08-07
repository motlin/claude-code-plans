import { Bot, CalendarClock, Gauge, KeyRound } from "lucide-react";
import type { SessionHookContextPayload } from "../lib/hook-events";

function ContextPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-200 px-2 py-0.5 text-xs text-text-500">
      <span className="text-text-600">{label}</span>
      <span className="font-medium text-text-300">{value}</span>
    </span>
  );
}

export function SessionHookContext({ context }: { context: SessionHookContextPayload }) {
  const backgroundTasks = context.backgroundTasks ?? [];
  const sessionCrons = context.sessionCrons ?? [];
  const hasTurnContext =
    Boolean(context.promptId) || Boolean(context.permissionMode) || Boolean(context.effortLevel);
  if (!hasTurnContext && backgroundTasks.length === 0 && sessionCrons.length === 0) return null;

  return (
    <section aria-label="Live hook context" className="mt-2 space-y-1.5">
      {hasTurnContext && (
        <div className="flex flex-wrap items-center gap-1.5">
          {context.permissionMode && (
            <ContextPill label="Permission" value={context.permissionMode} />
          )}
          {context.effortLevel && (
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3 w-3 text-text-600" />
              <ContextPill label="Effort" value={context.effortLevel} />
            </span>
          )}
          {context.promptId && (
            <span className="inline-flex items-center gap-1" title={context.promptId}>
              <KeyRound className="h-3 w-3 text-text-600" />
              <ContextPill label="Prompt" value={context.promptId.slice(0, 8)} />
            </span>
          )}
        </div>
      )}

      {backgroundTasks.length > 0 && (
        <div className="rounded-md border border-warning-000/20 bg-warning-100/10 px-2.5 py-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-warning-000">
            <Bot className="h-3.5 w-3.5" />
            Paused with {backgroundTasks.length} background task
            {backgroundTasks.length === 1 ? "" : "s"}
          </div>
          <ul className="mt-1 space-y-1 text-text-500">
            {backgroundTasks.map((task) => (
              <li key={task.id} className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded bg-bg-200 px-1.5 py-0.5 text-[10px]">
                  {task.status}
                </span>
                <span className="truncate">{task.description || task.name || task.type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sessionCrons.length > 0 && (
        <div className="rounded-md border border-accent-100/20 bg-bg-100 px-2.5 py-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-text-300">
            <CalendarClock className="h-3.5 w-3.5 text-accent-100" />
            Paused until {sessionCrons.length} scheduled wakeup
            {sessionCrons.length === 1 ? "" : "s"}
          </div>
          <ul className="mt-1 space-y-1 text-text-500">
            {sessionCrons.map((cron) => (
              <li key={cron.id} className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[10px] text-text-600">
                  {cron.schedule}
                </span>
                <span className="truncate">{cron.prompt}</span>
                {cron.recurring && <span className="shrink-0 text-text-600">recurring</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
