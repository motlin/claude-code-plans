import { readdir, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, basename } from "node:path";
import { createInterface } from "node:readline";
import { eq, notInArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  SessionsIndexSchema,
  FileHistorySnapshotSchema,
  CustomTitleRecordSchema,
  AttachmentRecordSchema,
  TaskFileSchema,
} from "../schemas";
import { decodeProjectDir, resolveProjectPath } from "../memory";
import { extractSessionTitle } from "../sessions";
import { extractTitle, extractTitleFromContent } from "../markdown-utils";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

const PLAN_PATH_RE = /\.claude\/plans\/([^/]+\.md)$/;

function extractFirstUserText(line: string): string | null {
  try {
    const obj = JSON.parse(line) as {
      type: string;
      message?: { content?: string | Array<{ type: string; text?: string }> };
    };
    if (obj.type !== "user") return null;
    const content = obj.message?.content;
    if (!content) return null;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          return block.text;
        }
      }
    }
  } catch {
    // skip malformed lines
  }
  return null;
}

async function readFirstUserMessage(filePath: string): Promise<string | null> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const text = extractFirstUserText(line);
      if (text !== null) return text;
    }
  } finally {
    rl.close();
  }
  return null;
}

export async function indexSessionsIndex(
  db: IndexDb,
  projectDir: string,
  project: string,
): Promise<void> {
  const indexPath = join(projectDir, "sessions-index.json");
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(indexPath);
  } catch {
    return;
  }

  const existing = db
    .select()
    .from(schema.indexedFiles)
    .where(eq(schema.indexedFiles.path, indexPath))
    .get();
  if (existing && existing.mtimeMs === fileStat.mtimeMs) return;

  let raw: string;
  try {
    raw = await readFile(indexPath, "utf-8");
  } catch {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const result = SessionsIndexSchema.safeParse(parsed);
  if (!result.success) return;

  const firstEntry = result.data.entries[0];
  const projectPath = firstEntry?.projectPath;
  const projectName = decodeProjectDir(project, projectPath);

  // Upsert project
  db.insert(schema.projects)
    .values({
      id: project,
      name: projectName,
      projectPath: projectPath ?? null,
      updatedAt: fileStat.mtimeMs,
    })
    .onConflictDoUpdate({
      target: schema.projects.id,
      set: {
        name: projectName,
        projectPath: projectPath ?? null,
        updatedAt: fileStat.mtimeMs,
      },
    })
    .run();

  // Upsert sessions
  for (const entry of result.data.entries) {
    const fp = entry.firstPrompt as string | undefined;
    const summ = entry.summary as string | undefined;
    const branch = entry.gitBranch as string | undefined;
    const entryProjectPath = entry.projectPath as string | undefined;
    const msgCount = (entry.messageCount as number | undefined) ?? 0;
    const sidechain = entry.isSidechain as boolean | undefined;
    const title = summ ?? (fp ? extractSessionTitle(fp, entry.sessionId) : entry.sessionId);
    const createdAt = entry.created ? new Date(entry.created as string).getTime() : entry.fileMtime;

    db.insert(schema.sessions)
      .values({
        id: entry.sessionId,
        projectId: project,
        title,
        firstPrompt: fp ?? null,
        summary: summ ?? null,
        customTitle: null,
        messageCount: msgCount,
        gitBranch: branch ?? null,
        cwd: entryProjectPath ?? null,
        isSidechain: sidechain ? 1 : 0,
        createdAt,
        mtimeMs: entry.fileMtime,
        filePath: entry.fullPath,
      })
      .onConflictDoUpdate({
        target: schema.sessions.id,
        set: {
          title,
          firstPrompt: fp ?? null,
          summary: summ ?? null,
          messageCount: msgCount,
          gitBranch: branch ?? null,
          cwd: entryProjectPath ?? null,
          isSidechain: sidechain ? 1 : 0,
          mtimeMs: entry.fileMtime,
        },
      })
      .run();
  }

  // Update indexed_files
  db.insert(schema.indexedFiles)
    .values({
      path: indexPath,
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      indexedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: schema.indexedFiles.path,
      set: {
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
        indexedAt: Date.now(),
      },
    })
    .run();
}

export async function indexJsonlFile(
  db: IndexDb,
  filePath: string,
  project: string,
): Promise<{ linkedPlans: string[] }> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    return { linkedPlans: [] };
  }

  const existing = db
    .select()
    .from(schema.indexedFiles)
    .where(eq(schema.indexedFiles.path, filePath))
    .get();
  if (existing && existing.mtimeMs === fileStat.mtimeMs) return { linkedPlans: [] };

  const sessionId = basename(filePath, ".jsonl");
  const planFilenames = new Set<string>();
  let customTitle: string | undefined;
  let sessionCwd: string | undefined;
  let sessionGitBranch: string | undefined;
  const textChunks: string[] = [];

  // Stream the file line-by-line to avoid loading entire JSONL into memory
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      if (line.includes("file-history-snapshot")) {
        try {
          const parsed = JSON.parse(line);
          const result = FileHistorySnapshotSchema.safeParse(parsed);
          if (result.success) {
            for (const key of Object.keys(result.data.snapshot.trackedFileBackups)) {
              const match = PLAN_PATH_RE.exec(key);
              if (match?.[1]) planFilenames.add(match[1]);
            }
          }
        } catch {
          // skip
        }
      }

      // plan_mode attachments link a session to its plan file even before
      // the plan is edited (file-history-snapshot only fires after edits).
      if (line.includes('"plan_mode"')) {
        try {
          const parsed = JSON.parse(line);
          const result = AttachmentRecordSchema.safeParse(parsed);
          if (result.success && result.data.attachment.type === "plan_mode") {
            const planPath = result.data.attachment.planFilePath;
            if (planPath) {
              const match = PLAN_PATH_RE.exec(planPath);
              if (match?.[1]) planFilenames.add(match[1]);
            }
          }
        } catch {
          // skip
        }
      }

      // Extract cwd from early lines (attachment, system, or init lines carry it)
      if (!sessionCwd && line.includes('"cwd"')) {
        try {
          const parsed = JSON.parse(line) as { cwd?: string };
          if (typeof parsed.cwd === "string") {
            sessionCwd = parsed.cwd;
          }
        } catch {
          // skip
        }
      }

      // Extract gitBranch from early lines
      if (!sessionGitBranch && line.includes('"gitBranch"')) {
        try {
          const parsed = JSON.parse(line) as { gitBranch?: string };
          if (typeof parsed.gitBranch === "string") {
            sessionGitBranch = parsed.gitBranch;
          }
        } catch {
          // skip
        }
      }

      if (line.includes("custom-title")) {
        try {
          const parsed = JSON.parse(line);
          const result = CustomTitleRecordSchema.safeParse(parsed);
          if (result.success) {
            customTitle = result.data.customTitle;
          }
        } catch {
          // skip
        }
      }

      // Extract text content for FTS indexing
      try {
        const obj = JSON.parse(line) as {
          type?: string;
          message?: {
            content?: string | Array<{ type?: string; text?: string }>;
          };
        };
        if (obj.type === "user" || obj.type === "assistant") {
          const content = obj.message?.content;
          if (typeof content === "string") {
            textChunks.push(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && typeof block.text === "string") {
                textChunks.push(block.text);
              }
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } finally {
    rl.close();
  }

  // Upsert plan links
  for (const planFilename of planFilenames) {
    db.insert(schema.planSessions)
      .values({ planFilename, sessionId, projectId: project })
      .onConflictDoNothing()
      .run();
  }

  const existingSession = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
  if (existingSession) {
    const updates: Record<string, unknown> = { mtimeMs: fileStat.mtimeMs };
    if (customTitle) {
      updates["customTitle"] = customTitle;
      updates["title"] = customTitle;
    }
    if (sessionCwd) {
      updates["cwd"] = sessionCwd;
    }
    if (sessionGitBranch) {
      updates["gitBranch"] = sessionGitBranch;
    }
    db.update(schema.sessions).set(updates).where(eq(schema.sessions.id, sessionId)).run();
  } else {
    const firstMsg = await readFirstUserMessage(filePath);
    const title = customTitle ?? extractSessionTitle(firstMsg ?? "", sessionId);
    const projectPath = await resolveProjectPath(project);
    const projectName = projectPath ? projectPath.split("/").pop()! : decodeProjectDir(project);

    // Ensure project exists
    db.insert(schema.projects)
      .values({
        id: project,
        name: projectName,
        projectPath,
        updatedAt: fileStat.mtimeMs,
      })
      .onConflictDoUpdate({
        target: schema.projects.id,
        set: { name: projectName, projectPath, updatedAt: fileStat.mtimeMs },
      })
      .run();

    db.insert(schema.sessions)
      .values({
        id: sessionId,
        projectId: project,
        title,
        firstPrompt: firstMsg ?? null,
        summary: null,
        customTitle: customTitle ?? null,
        messageCount: 0,
        gitBranch: sessionGitBranch ?? null,
        cwd: sessionCwd ?? null,
        isSidechain: 0,
        createdAt: fileStat.birthtimeMs,
        mtimeMs: fileStat.mtimeMs,
        filePath,
      })
      .run();
  }

  // Update message content FTS
  if (textChunks.length > 0) {
    const content = textChunks.join("\n");
    db.run(sql`DELETE FROM message_content_fts WHERE session_id = ${sessionId}`);
    db.run(
      sql`INSERT INTO message_content_fts(session_id, content) VALUES (${sessionId}, ${content})`,
    );
  }

  // Update indexed_files
  db.insert(schema.indexedFiles)
    .values({
      path: filePath,
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      indexedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: schema.indexedFiles.path,
      set: {
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
        indexedAt: Date.now(),
      },
    })
    .run();

  return { linkedPlans: Array.from(planFilenames) };
}

export async function indexSubagentFile(
  db: IndexDb,
  filePath: string,
  sessionId: string,
  project: string,
): Promise<void> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    return;
  }

  const existing = db
    .select()
    .from(schema.indexedFiles)
    .where(eq(schema.indexedFiles.path, filePath))
    .get();
  if (existing && existing.mtimeMs === fileStat.mtimeMs) return;

  const agentFilename = basename(filePath, ".jsonl");
  const metaPath = filePath.replace(/\.jsonl$/, ".meta.json");
  let agentType: string | null = null;
  let metaDescription: string | null = null;
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf-8")) as {
      agentType?: string;
      description?: string;
    };
    agentType = meta.agentType ?? null;
    metaDescription = meta.description ?? null;
  } catch {
    // no meta file
  }

  let slug: string | null = null;
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { slug?: string; timestamp?: string };
        if (obj.slug && !slug) slug = obj.slug;
        if (obj.timestamp) {
          if (!startedAt) startedAt = obj.timestamp;
          finishedAt = obj.timestamp;
        }
      } catch {
        // skip
      }
    }
  } finally {
    rl.close();
  }

  db.insert(schema.subagents)
    .values({
      id: agentFilename,
      sessionId,
      projectId: project,
      agentType,
      slug,
      description: metaDescription,
      startedAt,
      finishedAt,
      filePath,
      mtimeMs: fileStat.mtimeMs,
    })
    .onConflictDoUpdate({
      target: schema.subagents.id,
      set: {
        agentType,
        slug,
        description: metaDescription,
        startedAt,
        finishedAt,
        mtimeMs: fileStat.mtimeMs,
      },
    })
    .run();

  db.insert(schema.indexedFiles)
    .values({
      path: filePath,
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      indexedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: schema.indexedFiles.path,
      set: {
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
        indexedAt: Date.now(),
      },
    })
    .run();
}

const AGENT_ID_RE = /agentId:\s*(\S+)/;

export async function linkSubagentParents(
  db: IndexDb,
  jsonlPath: string,
  parentAgentId: string | null,
): Promise<void> {
  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  // Map tool_use id → description from the Agent call
  const toolCallDescriptions = new Map<string, string>();

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as {
          type?: string;
          message?: {
            content?:
              | string
              | Array<{
                  type?: string;
                  tool_use_id?: string;
                  content?: string | Array<{ type?: string; text?: string }>;
                  name?: string;
                  id?: string;
                  input?: { description?: string; prompt?: string };
                }>;
          };
        };

        const content = obj.message?.content;
        if (!Array.isArray(content)) continue;

        for (const block of content) {
          // Track Agent tool_use calls by their id + description
          if (block.type === "tool_use" && block.name === "Agent" && block.id) {
            const desc = block.input?.description ?? "";
            toolCallDescriptions.set(block.id, desc);
          }

          // Extract agentId from tool_result
          if (
            block.type === "tool_result" &&
            block.tool_use_id &&
            toolCallDescriptions.has(block.tool_use_id)
          ) {
            let resultText = "";
            if (typeof block.content === "string") {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter(
                  (b): b is { type: string; text: string } =>
                    b.type === "text" && typeof b.text === "string",
                )
                .map((b) => b.text)
                .join(" ");
            }
            const match = AGENT_ID_RE.exec(resultText);
            if (match?.[1]) {
              const agentId = `agent-${match[1]}`;
              const description = toolCallDescriptions.get(block.tool_use_id) || null;

              // COALESCE keeps existing parentAgentId so the root-session
              // pass doesn't overwrite nested parent links.
              db.run(
                sql`UPDATE subagents SET parent_agent_id = COALESCE(parent_agent_id, ${parentAgentId}), description = COALESCE(${description}, description) WHERE id = ${agentId}`,
              );
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } finally {
    rl.close();
  }
}

export async function indexTaskFile(
  db: IndexDb,
  filePath: string,
  projectDir: string,
): Promise<void> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    return;
  }

  const existing = db
    .select()
    .from(schema.indexedFiles)
    .where(eq(schema.indexedFiles.path, filePath))
    .get();
  if (existing && existing.mtimeMs === fileStat.mtimeMs) {
    const taskRow = db.select().from(schema.tasks).where(eq(schema.tasks.filePath, filePath)).get();
    if (taskRow) return;
  }

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const result = TaskFileSchema.safeParse(parsed);
  if (!result.success) return;

  const task = result.data;

  db.insert(schema.tasks)
    .values({
      filePath,
      taskId: task.id,
      projectDir,
      subject: task.subject,
      description: task.description,
      status: task.status,
      activeForm: task.activeForm ?? null,
      owner: task.owner ?? null,
      blocksJson: JSON.stringify(task.blocks),
      blockedByJson: JSON.stringify(task.blockedBy),
      metadataJson: JSON.stringify(task.metadata ?? {}),
      mtimeMs: fileStat.mtimeMs,
    })
    .onConflictDoUpdate({
      target: schema.tasks.filePath,
      set: {
        taskId: task.id,
        subject: task.subject,
        description: task.description,
        status: task.status,
        activeForm: task.activeForm ?? null,
        owner: task.owner ?? null,
        blocksJson: JSON.stringify(task.blocks),
        blockedByJson: JSON.stringify(task.blockedBy),
        metadataJson: JSON.stringify(task.metadata ?? {}),
        mtimeMs: fileStat.mtimeMs,
      },
    })
    .run();

  db.insert(schema.indexedFiles)
    .values({
      path: filePath,
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      indexedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: schema.indexedFiles.path,
      set: {
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
        indexedAt: Date.now(),
      },
    })
    .run();
}

export async function scanTasksDir(db: IndexDb, tasksDir: string): Promise<void> {
  let projectDirs: string[];
  try {
    projectDirs = await readdir(tasksDir);
  } catch {
    return;
  }

  const indexedPaths = new Set<string>();

  for (const projectDir of projectDirs) {
    const projectPath = join(tasksDir, projectDir);
    try {
      const dirStat = await stat(projectPath);
      if (!dirStat.isDirectory()) continue;
    } catch {
      continue;
    }

    let files: string[];
    try {
      files = await readdir(projectPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(projectPath, file);
      indexedPaths.add(filePath);
      await indexTaskFile(db, filePath, projectDir);
    }
  }

  // Clean up deleted files
  const allTasks = db.select({ filePath: schema.tasks.filePath }).from(schema.tasks).all();
  for (const row of allTasks) {
    if (!indexedPaths.has(row.filePath)) {
      db.delete(schema.tasks).where(eq(schema.tasks.filePath, row.filePath)).run();
      db.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, row.filePath)).run();
    }
  }
}

export async function indexMemoryFile(
  db: IndexDb,
  filePath: string,
  projectId: string,
): Promise<void> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    return;
  }

  const existing = db
    .select()
    .from(schema.indexedFiles)
    .where(eq(schema.indexedFiles.path, filePath))
    .get();
  if (existing && existing.mtimeMs === fileStat.mtimeMs) {
    const memoryRow = db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.filePath, filePath))
      .get();
    if (memoryRow) return;
  }

  const filename = basename(filePath);
  const title = await extractTitle(filePath, filename);

  db.insert(schema.memories)
    .values({
      filePath,
      projectId,
      filename,
      title,
      mtimeMs: fileStat.mtimeMs,
    })
    .onConflictDoUpdate({
      target: schema.memories.filePath,
      set: {
        projectId,
        filename,
        title,
        mtimeMs: fileStat.mtimeMs,
      },
    })
    .run();

  db.insert(schema.indexedFiles)
    .values({
      path: filePath,
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      indexedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: schema.indexedFiles.path,
      set: {
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
        indexedAt: Date.now(),
      },
    })
    .run();
}

export async function scanMemoriesForProject(
  db: IndexDb,
  projectsDir: string,
  projectId: string,
): Promise<void> {
  const memoryDir = join(projectsDir, projectId, "memory");
  let files: string[];
  try {
    files = await readdir(memoryDir);
  } catch {
    // memory dir missing — prune any stale rows for this project and return
    const stale = db
      .select({ filePath: schema.memories.filePath })
      .from(schema.memories)
      .where(eq(schema.memories.projectId, projectId))
      .all();
    for (const row of stale) {
      db.delete(schema.memories).where(eq(schema.memories.filePath, row.filePath)).run();
      db.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, row.filePath)).run();
    }
    return;
  }

  const indexedPaths = new Set<string>();
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = join(memoryDir, file);
    indexedPaths.add(filePath);
    await indexMemoryFile(db, filePath, projectId);
  }

  // Prune memory rows for this project whose filePath is missing on disk
  const existingRows = db
    .select({ filePath: schema.memories.filePath })
    .from(schema.memories)
    .where(eq(schema.memories.projectId, projectId))
    .all();
  for (const row of existingRows) {
    if (!indexedPaths.has(row.filePath)) {
      db.delete(schema.memories).where(eq(schema.memories.filePath, row.filePath)).run();
      db.delete(schema.indexedFiles).where(eq(schema.indexedFiles.path, row.filePath)).run();
    }
  }
}

/**
 * Remove plan_sessions rows whose plan file no longer exists on disk. Returns
 * the number of rows deleted. Leaves the table untouched when the plans
 * directory itself is unreadable — we never want a transient fs hiccup to wipe
 * the entire linkage table.
 */
export async function pruneStalePlanLinks(db: IndexDb, plansDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(plansDir);
  } catch {
    return 0;
  }

  const existingPlans = entries.filter((f) => f.endsWith(".md"));

  // notInArray with an empty list is a no-op SQL-wise, so short-circuit.
  if (existingPlans.length === 0) {
    const result = db.delete(schema.planSessions).run();
    return result.changes;
  }

  const result = db
    .delete(schema.planSessions)
    .where(notInArray(schema.planSessions.planFilename, existingPlans))
    .run();
  return result.changes;
}

/**
 * Delete the row for `filename` from the `plans` table, along with its
 * matching `indexed_files` cache entry. Idempotent — running twice is fine.
 */
export function deletePlan(db: IndexDb, plansDir: string, filename: string): void {
  db.delete(schema.plans).where(eq(schema.plans.filename, filename)).run();
  db.delete(schema.indexedFiles)
    .where(eq(schema.indexedFiles.path, join(plansDir, filename)))
    .run();
}

/**
 * Per-file indexer for a single plan markdown file. Mirrors `indexTaskFile`.
 *
 * - If the file is missing on disk, delete the `plans` row and return.
 * - If the `indexed_files` cache shows the same mtime, short-circuit.
 * - Otherwise read content, compute a display title, upsert the `plans` row
 *   keyed on `filename`, and upsert the `indexed_files` row.
 */
export async function indexPlanFile(
  db: IndexDb,
  plansDir: string,
  filename: string,
): Promise<{ changed: boolean }> {
  const filePath = join(plansDir, filename);
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    deletePlan(db, plansDir, filename);
    return { changed: true };
  }

  const existing = db
    .select()
    .from(schema.indexedFiles)
    .where(eq(schema.indexedFiles.path, filePath))
    .get();
  if (existing && existing.mtimeMs === fileStat.mtimeMs) {
    return { changed: false };
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    deletePlan(db, plansDir, filename);
    return { changed: true };
  }

  const title = extractTitleFromContent(content, filename);

  db.insert(schema.plans)
    .values({ filename, title, mtimeMs: fileStat.mtimeMs })
    .onConflictDoUpdate({
      target: schema.plans.filename,
      set: { title, mtimeMs: fileStat.mtimeMs },
    })
    .run();

  db.insert(schema.indexedFiles)
    .values({
      path: filePath,
      mtimeMs: fileStat.mtimeMs,
      sizeBytes: fileStat.size,
      indexedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: schema.indexedFiles.path,
      set: {
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
        indexedAt: Date.now(),
      },
    })
    .run();

  return { changed: true };
}

/**
 * Scan the plans directory, indexing each `.md` file via `indexPlanFile` and
 * pruning `plans` rows (plus their `indexed_files` cache entries) whose
 * filename is no longer on disk. Mirrors `scanTasksDir`.
 *
 * The `indexed_files` mtime short-circuit inside `indexPlanFile` makes repeat
 * passes cheap — only changed files do real work.
 */
export async function scanPlansDir(db: IndexDb, plansDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(plansDir);
  } catch {
    return;
  }

  const indexedFilenames = new Set<string>();
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    indexedFilenames.add(entry);
    await indexPlanFile(db, plansDir, entry);
  }

  // Prune plans rows whose filename is missing on disk.
  const existingPlans = db.select({ filename: schema.plans.filename }).from(schema.plans).all();
  for (const row of existingPlans) {
    if (!indexedFilenames.has(row.filename)) {
      deletePlan(db, plansDir, row.filename);
    }
  }
}

let indexingInProgress = false;
export function isCurrentlyIndexing(): boolean {
  return indexingInProgress;
}

/** Max concurrent session files indexed during a full scan. */
const SCAN_CONCURRENCY = 8;

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

/** Snapshot of indexed_files mtimes, so the scan can detect changes in memory. */
function loadIndexedFileMtimes(db: IndexDb): Map<string, number> {
  const rows = db
    .select({ path: schema.indexedFiles.path, mtimeMs: schema.indexedFiles.mtimeMs })
    .from(schema.indexedFiles)
    .all();
  return new Map(rows.map((r) => [r.path, r.mtimeMs]));
}

export async function fullScan(
  db: IndexDb,
  projectsDir: string,
  tasksDir?: string,
  plansDir?: string,
): Promise<void> {
  indexingInProgress = true;
  try {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(projectsDir);
    } catch {
      return;
    }

    // Validate project dirs and capture a recency signal, so the most-recently
    // active projects are indexed first and fresh sessions surface within
    // seconds rather than after the whole scan completes.
    const projects: { project: string; projectPath: string; recency: number }[] = [];
    for (const project of projectDirs) {
      const projectPath = join(projectsDir, project);
      let recency: number;
      try {
        const dirStat = await stat(projectPath);
        if (!dirStat.isDirectory()) continue;
        recency = dirStat.mtimeMs;
      } catch {
        continue;
      }
      // sessions-index.json is rewritten as a project's sessions change, so it
      // is a better recency signal than the dir mtime on filesystems that don't
      // bump the dir when an existing file is appended to.
      try {
        const idxStat = await stat(join(projectPath, "sessions-index.json"));
        recency = Math.max(recency, idxStat.mtimeMs);
      } catch {
        // no sessions-index.json
      }
      projects.push({ project, projectPath, recency });
    }
    projects.sort((a, b) => b.recency - a.recency);

    // One bulk read of indexed_files so per-session change detection (used to
    // skip the expensive subagent re-link) is an in-memory lookup.
    const knownMtimes = loadIndexedFileMtimes(db);

    for (const { project, projectPath } of projects) {
      // Index sessions-index.json
      await indexSessionsIndex(db, projectPath, project);

      // Discover session JSONL files with their mtimes, newest first.
      let files: string[];
      try {
        files = await readdir(projectPath);
      } catch {
        continue;
      }
      const sessionFiles = await Promise.all(
        files
          .filter((f) => f.endsWith(".jsonl"))
          .map(async (f) => {
            const path = join(projectPath, f);
            let mtimeMs = 0;
            try {
              mtimeMs = (await stat(path)).mtimeMs;
            } catch {
              // unreadable; indexJsonlFile will skip it too
            }
            return { sessionId: f.replace(/\.jsonl$/, ""), path, mtimeMs };
          }),
      );
      sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

      // Index JSONL files with bounded concurrency.
      await mapLimit(sessionFiles, SCAN_CONCURRENCY, async ({ path }) => {
        await indexJsonlFile(db, path, project);
      });

      // Index subagents and (re)link parent-child relationships. Linking
      // re-streams whole JSONL files, so only do it for sessions whose root or
      // subagent files actually changed since the last scan.
      for (const { sessionId, path: sessionJsonlPath, mtimeMs: sessionMtime } of sessionFiles) {
        const subagentsDir = join(projectPath, sessionId, "subagents");
        let subFiles: string[];
        try {
          subFiles = await readdir(subagentsDir);
        } catch {
          continue;
        }

        let changed = knownMtimes.get(sessionJsonlPath) !== sessionMtime;
        const subagentJsonlPaths: string[] = [];
        for (const sf of subFiles) {
          if (!sf.startsWith("agent-") || !sf.endsWith(".jsonl")) continue;
          const sfPath = join(subagentsDir, sf);
          let sfMtime = 0;
          try {
            sfMtime = (await stat(sfPath)).mtimeMs;
          } catch {
            continue;
          }
          if (knownMtimes.get(sfPath) !== sfMtime) changed = true;
          await indexSubagentFile(db, sfPath, sessionId, project);
          subagentJsonlPaths.push(sfPath);
        }

        if (changed && subagentJsonlPaths.length > 0) {
          for (const saPath of subagentJsonlPaths) {
            await linkSubagentParents(db, saPath, basename(saPath, ".jsonl"));
          }
          await linkSubagentParents(db, sessionJsonlPath, null);
        }
      }

      // Index memory markdown files for this project
      await scanMemoriesForProject(db, projectsDir, project);
    }

    if (tasksDir) {
      await scanTasksDir(db, tasksDir);
    }

    if (plansDir) {
      await scanPlansDir(db, plansDir);
      await pruneStalePlanLinks(db, plansDir);
    }
  } finally {
    indexingInProgress = false;
  }
}

export async function indexFile(
  db: IndexDb,
  filePath: string,
  projectsDir: string,
  plansDir?: string,
): Promise<{ linkedPlans: string[] }> {
  // Task file: ~/.claude/tasks/{projectDir}/{id}.json
  if (filePath.includes("/tasks/") && filePath.endsWith(".json")) {
    const parts = filePath.split("/");
    const tasksIdx = parts.lastIndexOf("tasks");
    const projectDir = parts[tasksIdx + 1];
    if (projectDir) {
      await indexTaskFile(db, filePath, projectDir);
    }
    return { linkedPlans: [] };
  }

  // Plan markdown file: ~/.claude/plans/{filename}.md
  if (filePath.endsWith(".md") && plansDir && filePath.startsWith(plansDir)) {
    const filename = basename(filePath);
    await indexPlanFile(db, plansDir, filename);
    return { linkedPlans: [] };
  }

  // Memory markdown file: {projectsDir}/{project}/memory/{filename}.md
  if (filePath.endsWith(".md") && filePath.startsWith(projectsDir + "/")) {
    const rel = filePath.slice(projectsDir.length + 1);
    const parts = rel.split("/");
    if (parts.length === 3 && parts[1] === "memory") {
      const project = parts[0]!;
      await indexMemoryFile(db, filePath, project);
      return { linkedPlans: [] };
    }
  }

  // Determine what kind of file changed and index accordingly
  if (filePath.endsWith("sessions-index.json")) {
    const parts = filePath.split("/");
    const projectIdx = parts.lastIndexOf("sessions-index.json") - 1;
    if (projectIdx >= 0) {
      const project = parts[projectIdx]!;
      const projectDir = parts.slice(0, projectIdx + 1).join("/");
      await indexSessionsIndex(db, projectDir, project);
    }
    return { linkedPlans: [] };
  }

  if (filePath.endsWith(".jsonl")) {
    // Check if this is a subagent file
    if (filePath.includes("/subagents/") && basename(filePath).startsWith("agent-")) {
      const parts = filePath.split("/");
      const subagentsIdx = parts.indexOf("subagents");
      if (subagentsIdx >= 2) {
        const sessionId = parts[subagentsIdx - 1]!;
        // Walk back to find project dir
        const projectsDirParts = projectsDir.split("/");
        const projectsEndIdx = projectsDirParts.length;
        const project = parts[projectsEndIdx]!;
        if (project) {
          await indexSubagentFile(db, filePath, sessionId, project);
          // Link nested parent-child relationships from this subagent's JSONL
          const agentFilename = basename(filePath, ".jsonl");
          await linkSubagentParents(db, filePath, agentFilename);
        }
      }
      return { linkedPlans: [] };
    }

    // Regular session JSONL
    const parts = filePath.split("/");
    const projectsDirParts = projectsDir.split("/");
    const project = parts[projectsDirParts.length];
    if (project) {
      const result = await indexJsonlFile(db, filePath, project);
      // Link parent-child relationships from root session JSONL
      await linkSubagentParents(db, filePath, null);
      return result;
    }
  }

  return { linkedPlans: [] };
}
