#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import {
  getPendingApprovals,
  initPendingApprovalsCache,
} from "../src/lib/db/pending-approvals-cache";
import { openCorpusDatabase, type CorpusDatabase } from "./database";
import {
  getPrompt,
  getSession,
  listProjects,
  listSessions,
  listSubagents,
  readConversation,
  search,
  type ToolContext,
} from "./tools";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// This process inherits the invoking user's filesystem access and needs no token.
// Future write tools must only stage a status-bearing proposal for human approval.

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

export function createCorpusMcpServer(context: ToolContext): McpServer {
  const server = new McpServer({ name: "claude-code-plans", version: "1.0.0" });

  server.registerTool(
    "list_sessions",
    {
      description: "List recent indexed Claude sessions without changing viewed or activity state.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z
          .object({ updated: z.iso.datetime(), id: z.string().min(1) })
          .optional()
          .describe("Cursor returned by a prior call."),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      Promise.resolve(
        toolResult(
          listSessions(context, {
            limit: input.limit,
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          }),
        ),
      ),
  );

  server.registerTool(
    "read_conversation",
    {
      description: "Read an explicit range of structured JSONL transcript records.",
      inputSchema: {
        id: z.string().min(1),
        offset: z.number().int().min(0),
        limit: z.number().int().min(1).max(100),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => Promise.resolve(toolResult(readConversation(context, input))),
  );

  server.registerTool(
    "search",
    {
      description: "Search indexed session metadata and structured message content.",
      inputSchema: {
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).max(25).default(10),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => Promise.resolve(toolResult(search(context, input))),
  );

  server.registerTool(
    "get_prompt",
    {
      description: "List transcript-derived pending prompts without resolving or viewing them.",
      inputSchema: {
        sessionId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      Promise.resolve(
        toolResult(
          getPrompt(context, {
            limit: input.limit,
            ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          }),
        ),
      ),
  );

  server.registerTool(
    "get_session",
    {
      description: "Get indexed metadata for one session.",
      inputSchema: { id: z.string().min(1) },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => Promise.resolve(toolResult(getSession(context, input))),
  );

  server.registerTool(
    "list_subagents",
    {
      description: "List indexed subagents for one session.",
      inputSchema: {
        id: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => Promise.resolve(toolResult(listSubagents(context, input))),
  );

  server.registerTool(
    "list_projects",
    {
      description: "List indexed projects and their session counts.",
      inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => Promise.resolve(toolResult(listProjects(context, input))),
  );

  return server;
}

async function main(): Promise<void> {
  const database = openCorpusDatabase();
  await initPendingApprovalsCache(database.index);
  const context: ToolContext = {
    db: database.index,
    now: Date.now,
    pendingApprovals: getPendingApprovals,
  };
  const server = createCorpusMcpServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  installShutdownHandlers(server, database);
}

function installShutdownHandlers(server: McpServer, database: CorpusDatabase): void {
  const shutdown = async () => {
    await server.close();
    database.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
