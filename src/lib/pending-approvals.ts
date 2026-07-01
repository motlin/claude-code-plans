import { createReadStream, statSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";
import { getPlanFilenameForSession } from "./db/queries";

type IndexDb = BetterSQLite3Database<typeof schema>;

export type PendingApprovalToolName = "ExitPlanMode" | "AskUserQuestion";

const STALE_APPROVAL_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PendingApproval {
  sessionId: string;
  projectId: string;
  projectName: string;
  toolName: PendingApprovalToolName;
  toolUseId: string;
  blockedSince: string;
  planFilename: string | null;
  questionPreview: string | null;
}

interface PendingEntry {
  sessionId: string;
  toolName: PendingApprovalToolName;
  toolUseId: string;
  blockedSince: string;
  planFilename: string | null;
  questionPreview: string | null;
}

interface JsonlContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

interface JsonlMessage {
  role?: string;
  content?: unknown;
}

interface JsonlEntry {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  message?: JsonlMessage;
}

function extractPlanFilename(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const candidate =
    (typeof input["planFilePath"] === "string" && input["planFilePath"]) ||
    (typeof input["planFile"] === "string" && input["planFile"]) ||
    (typeof input["filePath"] === "string" && input["filePath"]) ||
    (typeof input["path"] === "string" && input["path"]) ||
    null;
  if (!candidate) return null;
  return basename(candidate);
}

function extractQuestionPreview(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const direct = input["question"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const questions = input["questions"];
  if (Array.isArray(questions) && questions.length > 0) {
    const first = questions[0];
    if (first && typeof first === "object") {
      const text = (first as Record<string, unknown>)["question"];
      if (typeof text === "string" && text.trim()) return text.trim();
    }
    if (typeof first === "string" && first.trim()) return first.trim();
  }
  return null;
}

export async function scanPendingApproval(filePath: string): Promise<PendingApproval | null> {
  const pending = new Map<string, PendingEntry>();
  let sessionId = "";

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: JsonlEntry;
      try {
        obj = JSON.parse(line) as JsonlEntry;
      } catch {
        continue;
      }

      if (typeof obj.sessionId === "string" && obj.sessionId) {
        sessionId = obj.sessionId;
      }

      const type = obj.type;
      if (type !== "user" && type !== "assistant") continue;

      const message = obj.message;
      if (!message) continue;

      const content = message.content;
      if (!Array.isArray(content)) continue;

      const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : "";

      if (type === "assistant") {
        for (const block of content as JsonlContentBlock[]) {
          if (block.type !== "tool_use") continue;
          const name = block.name;
          if (name !== "ExitPlanMode" && name !== "AskUserQuestion") continue;
          const id = typeof block.id === "string" ? block.id : "";
          if (!id) continue;
          pending.set(id, {
            sessionId,
            toolName: name,
            toolUseId: id,
            blockedSince: timestamp,
            planFilename: name === "ExitPlanMode" ? extractPlanFilename(block.input) : null,
            questionPreview:
              name === "AskUserQuestion" ? extractQuestionPreview(block.input) : null,
          });
        }
      } else {
        for (const block of content as JsonlContentBlock[]) {
          if (block.type !== "tool_result") continue;
          const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
          if (!id) continue;
          pending.delete(id);
        }
      }
    }
  } finally {
    rl.close();
  }

  if (pending.size === 0) return null;

  let latest: PendingEntry | null = null;
  for (const entry of pending.values()) {
    if (!latest || entry.blockedSince > latest.blockedSince) {
      latest = entry;
    }
  }
  if (!latest) return null;

  return {
    sessionId: latest.sessionId,
    projectId: "",
    projectName: "",
    toolName: latest.toolName,
    toolUseId: latest.toolUseId,
    blockedSince: latest.blockedSince,
    planFilename: latest.planFilename,
    questionPreview: latest.questionPreview,
  };
}

export async function scanAllPendingApprovals(db: IndexDb): Promise<PendingApproval[]> {
  const sessionRows = db
    .select({
      id: schema.sessions.id,
      projectId: schema.sessions.projectId,
      filePath: schema.sessions.filePath,
    })
    .from(schema.sessions)
    .all();

  const projectRows = db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .all();
  const projectNames = new Map(projectRows.map((r) => [r.id, r.name]));

  const staleCutoff = Date.now() - STALE_APPROVAL_THRESHOLD_MS;
  const results: PendingApproval[] = [];
  for (const row of sessionRows) {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(row.filePath).mtimeMs;
    } catch {
      continue; // file deleted since indexing
    }
    if (mtimeMs < staleCutoff) continue; // session untouched for >7 days

    let approval: PendingApproval | null;
    try {
      approval = await scanPendingApproval(row.filePath);
    } catch {
      continue; // session file deleted since indexing; initial scan will prune the row
    }
    if (!approval) continue;
    const planFilename =
      approval.planFilename ?? getPlanFilenameForSession(db, approval.sessionId || row.id);
    results.push({
      ...approval,
      sessionId: approval.sessionId || row.id,
      projectId: row.projectId,
      projectName: projectNames.get(row.projectId) ?? row.projectId,
      planFilename,
    });
  }

  results.sort((a, b) => a.blockedSince.localeCompare(b.blockedSince));
  return results;
}
