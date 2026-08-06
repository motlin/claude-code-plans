import { sql } from "drizzle-orm";
import {
  getSessionMeta,
  getSubagentsForSession,
  listProjectsFromDb,
  listRecentSessionsFromDb,
  searchMessageContentDb,
  searchSessionsFromDb,
} from "../src/lib/db/queries";
import { readStructuredTranscript } from "../src/lib/structured-transcript";
import type { PendingApproval } from "../src/lib/pending-approvals";
import type { ReadonlyIndexDb } from "./database";

const INDEX_STALE_AFTER_MS = 5 * 60 * 1000;
const SESSION_LIMIT = 50;
const CONVERSATION_LIMIT = 100;
const SEARCH_LIMIT = 25;
const PROMPT_LIMIT = 50;
const PROJECT_LIMIT = 50;
const SUBAGENT_LIMIT = 50;

export interface ToolContext {
  db: ReadonlyIndexDb;
  now(): number;
  pendingApprovals(): PendingApproval[];
}

export interface ListSessionsInput {
  limit: number;
  cursor?: {
    updated: string;
    id: string;
  };
}

export interface ReadConversationInput {
  id: string;
  offset: number;
  limit: number;
}

export interface SearchInput {
  query: string;
  limit: number;
}

export interface GetPromptInput {
  limit: number;
  sessionId?: string;
}

export interface GetSessionInput {
  id: string;
}

export interface ListSubagentsInput {
  id: string;
  limit: number;
}

export interface ListProjectsInput {
  limit: number;
}

function assertLimit(name: string, value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 through ${maximum}`);
  }
}

function omitNullFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== null).map(omitNullFields);
  }
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== null && entry !== undefined)
    .map(([key, entry]) => [key, omitNullFields(entry)]);
  return Object.fromEntries(entries);
}

function isoTimestamp(timestamp: string): string {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`Invalid timestamp: ${timestamp}`);
  return new Date(milliseconds).toISOString();
}

function indexStatus(context: ToolContext): {
  updated?: string;
  stale: boolean;
  note?: string;
} {
  const row = context.db.get(sql`SELECT max(indexed_at) AS indexed_at FROM indexed_files`) as {
    indexed_at: number | null;
  };
  const indexedAt = row.indexed_at;
  const stale = indexedAt === null || context.now() - indexedAt > INDEX_STALE_AFTER_MS;
  return {
    ...(indexedAt === null ? {} : { updated: new Date(indexedAt).toISOString() }),
    stale,
    ...(stale
      ? {
          note: "The ccp index may be stale. Start ccp to refresh it; this MCP server never indexes.",
        }
      : {}),
  };
}

export function listSessions(context: ToolContext, input: ListSessionsInput) {
  assertLimit("limit", input.limit, SESSION_LIMIT);
  const before = input.cursor
    ? { mtimeMs: Date.parse(input.cursor.updated), id: input.cursor.id }
    : undefined;
  if (before && !Number.isFinite(before.mtimeMs)) {
    throw new TypeError(`Invalid cursor timestamp: ${input.cursor?.updated ?? ""}`);
  }
  const page = listRecentSessionsFromDb(context.db, {
    limit: input.limit,
    ...(before ? { before } : {}),
  });
  return {
    sessions: page.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      project: session.projectName,
      updated: session.mtime.toISOString(),
      created: session.created.toISOString(),
      messages: session.messageCount,
      ...(session.summary === undefined ? {} : { summary: session.summary }),
      ...(session.gitBranch === undefined ? {} : { branch: session.gitBranch }),
      ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
    })),
    hasMore: page.nextCursor !== null,
    ...(page.nextCursor
      ? {
          cursor: {
            updated: new Date(page.nextCursor.mtimeMs).toISOString(),
            id: page.nextCursor.id,
          },
        }
      : {}),
    index: indexStatus(context),
  };
}

export function readConversation(context: ToolContext, input: ReadConversationInput) {
  if (!Number.isInteger(input.offset) || input.offset < 0) {
    throw new RangeError("offset must be a non-negative integer");
  }
  assertLimit("limit", input.limit, CONVERSATION_LIMIT);
  const transcript = readStructuredTranscript(context.db, input.id);
  const records = transcript.records.slice(input.offset, input.offset + input.limit);
  return {
    id: input.id,
    offset: input.offset,
    total: transcript.records.length,
    records: omitNullFields(records),
    hasMore: input.offset + records.length < transcript.records.length,
    index: indexStatus(context),
  };
}

export function search(context: ToolContext, input: SearchInput) {
  assertLimit("limit", input.limit, SEARCH_LIMIT);
  if (!input.query.trim()) throw new TypeError("query must not be empty");
  const sessionResults = searchSessionsFromDb(context.db, input.query);
  const messageResults = searchMessageContentDb(context.db, input.query, input.limit + 1);
  return {
    sessions: sessionResults.slice(0, input.limit).map((result) => ({
      id: result.sessionId,
      title: result.title,
      project: result.projectName,
      updated: result.mtime,
      messages: result.messageCount,
      snippet: result.snippet,
      ...(result.summary === null ? {} : { summary: result.summary }),
    })),
    messages: messageResults.slice(0, input.limit).map((result) => ({
      id: result.sessionId,
      title: result.title,
      project: result.projectName,
      updated: result.mtime,
      messages: result.messageCount,
      snippet: result.snippet,
    })),
    hasMore: sessionResults.length > input.limit || messageResults.length > input.limit,
    index: indexStatus(context),
  };
}

export function getPrompt(context: ToolContext, input: GetPromptInput) {
  assertLimit("limit", input.limit, PROMPT_LIMIT);
  const approvals = context
    .pendingApprovals()
    .filter((approval) => input.sessionId === undefined || approval.sessionId === input.sessionId);
  return {
    prompts: approvals.slice(0, input.limit).map((approval) => ({
      id: approval.toolUseId,
      session: approval.sessionId,
      project: approval.projectName,
      tool: approval.toolName,
      blocked: isoTimestamp(approval.blockedSince),
      ...(approval.planFilename === null ? {} : { plan: approval.planFilename }),
      ...(approval.questionPreview === null ? {} : { question: approval.questionPreview }),
    })),
    hasMore: approvals.length > input.limit,
    index: indexStatus(context),
  };
}

export function getSession(context: ToolContext, input: GetSessionInput) {
  const session = getSessionMeta(context.db, input.id);
  return {
    ...(session
      ? {
          session: {
            id: input.id,
            messages: session.messageCount,
            ...(session.projectName === null ? {} : { project: session.projectName }),
            ...(session.gitBranch === null ? {} : { branch: session.gitBranch }),
            ...(session.cwd === null ? {} : { cwd: session.cwd }),
          },
        }
      : {}),
    found: session !== null,
    index: indexStatus(context),
  };
}

export function listSubagents(context: ToolContext, input: ListSubagentsInput) {
  assertLimit("limit", input.limit, SUBAGENT_LIMIT);
  const rows = getSubagentsForSession(context.db, input.id);
  return {
    subagents: rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      session: row.sessionId,
      project: row.projectId,
      updated: new Date(row.mtimeMs).toISOString(),
      ...(row.parentAgentId === null ? {} : { parent: row.parentAgentId }),
      ...(row.agentType === null ? {} : { type: row.agentType }),
      ...(row.slug === null ? {} : { slug: row.slug }),
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.startedAt === null ? {} : { started: isoTimestamp(row.startedAt) }),
      ...(row.finishedAt === null ? {} : { finished: isoTimestamp(row.finishedAt) }),
    })),
    hasMore: rows.length > input.limit,
    index: indexStatus(context),
  };
}

export function listProjects(context: ToolContext, input: ListProjectsInput) {
  assertLimit("limit", input.limit, PROJECT_LIMIT);
  const rows = listProjectsFromDb(context.db);
  return {
    projects: rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      name: row.name,
      sessions: row.sessionCount,
      updated: new Date(row.lastActivity).toISOString(),
      ...(row.projectPath === null ? {} : { path: row.projectPath }),
    })),
    hasMore: rows.length > input.limit,
    index: indexStatus(context),
  };
}
