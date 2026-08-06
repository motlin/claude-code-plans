import { z } from "zod";
import { getDb } from "./db";
import { getSessionProjectPath } from "./db/queries";
import { spawnClaude, killProcess } from "./cli-runner";
import { broadcast } from "./watcher";

/**
 * Shared "fork-and-stream" plumbing for endpoints that resume a Claude Code
 * session with a new user prompt (e.g. /api/chat for follow-up messages,
 * /api/answer-question for AskUserQuestion answers). The prompt is supplied
 * by the caller; everything else — cancel handling, project-path lookup,
 * spawning the CLI, draining the stream so the broadcast fires, and shaping
 * the streaming HTTP response — is handled here.
 */

const cancelSchema = z.object({
  action: z.literal("cancel"),
  processId: z.string(),
});

export function handleCancel(json: unknown): Response | null {
  const result = cancelSchema.safeParse(json);
  if (!result.success) return null;
  const killed = killProcess(result.data.processId);
  return Response.json({ ok: killed });
}

export function spawnResumeStream({
  sessionId,
  prompt,
}: {
  sessionId: string;
  prompt: string;
}): Response {
  const { index } = getDb();
  const projectPath = getSessionProjectPath(index, sessionId);
  if (!projectPath) {
    return Response.json(
      { error: "Could not determine project directory for session" },
      { status: 404 },
    );
  }

  const { stream, processId } = spawnClaude({
    sessionId,
    prompt,
    projectDir: projectPath,
    environment: {},
  });

  // Drain a copy of the stream so the spawned CLI runs to completion and we
  // fire the SSE broadcast once the new JSONL has been written. The other
  // half of the tee is what the HTTP client receives.
  const [passthrough, monitor] = stream.tee();
  void drainAndBroadcast(monitor);

  return new Response(passthrough, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Process-Id": processId,
    },
  });
}

async function drainAndBroadcast(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
    // Small delay so JSONL writes flush before consumers refetch.
    setTimeout(() => broadcast(), 1000);
  }
}
