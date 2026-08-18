import { delimiter, join } from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import {
  PersistedCapabilitiesSchema,
  resolveServerCapabilities,
  type CapabilityRuntimeFactsById,
  type RuntimeUnavailabilityReason,
} from "../../lib/capabilities";
import { DatabaseSchemaTooNewError } from "../../lib/db/connection";
import { rejectCrossSite } from "../../lib/same-origin-guard";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function executableExists(command: string): Promise<boolean> {
  const directories = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean);
  const results = await Promise.all(
    directories.map(async (directory) => {
      try {
        await access(join(directory, command), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}

async function databaseAvailable(): Promise<boolean> {
  const { getDb } = await import("../../lib/db");
  getDb();
  return true;
}

type DatabaseUnavailabilityReason = Extract<
  RuntimeUnavailabilityReason,
  { type: "database-schema-too-new" | "database-unavailable" }
>;

type DatabaseProbeResult =
  | { available: true; unavailabilityReason: null }
  | { available: false; unavailabilityReason: DatabaseUnavailabilityReason };

async function probeDatabaseAvailability(
  checkAvailability: () => Promise<boolean>,
): Promise<DatabaseProbeResult> {
  try {
    if (await checkAvailability()) {
      return { available: true, unavailabilityReason: null };
    }
    return {
      available: false,
      unavailabilityReason: { type: "database-unavailable" },
    };
  } catch (error) {
    console.error("Capability database probe failed:", error);
    if (error instanceof DatabaseSchemaTooNewError) {
      return {
        available: false,
        unavailabilityReason: {
          type: "database-schema-too-new",
          databaseSchemaVersion: error.databaseSchemaVersion,
          applicationSchemaVersion: error.applicationSchemaVersion,
        },
      };
    }
    return {
      available: false,
      unavailabilityReason: { type: "database-unavailable" },
    };
  }
}

export interface CapabilityProbeDependencies {
  pathExists(path: string): Promise<boolean>;
  executableExists(command: string): Promise<boolean>;
  databaseAvailable(): Promise<boolean>;
  projectRoot: string;
}

async function probeCapabilityRuntime(
  dependencies: CapabilityProbeDependencies,
): Promise<CapabilityRuntimeFactsById> {
  const [
    mcpInstalled,
    reviewSkillInstalled,
    contextBriefInstalled,
    claudeAvailable,
    databaseProbe,
  ] = await Promise.all([
    dependencies.pathExists(join(dependencies.projectRoot, "mcp-server", "index.ts")),
    dependencies.pathExists(
      join(dependencies.projectRoot, ".claude", "skills", "review-working-copy", "SKILL.md"),
    ),
    dependencies.pathExists(join(dependencies.projectRoot, "src", "lib", "context-brief.ts")),
    dependencies.executableExists("claude"),
    probeDatabaseAvailability(() => dependencies.databaseAvailable()),
  ]);

  const databaseReason = databaseProbe.unavailabilityReason;
  const reviewReason: RuntimeUnavailabilityReason | null =
    databaseReason ?? (claudeAvailable ? null : { type: "claude-not-found" });

  return {
    readOnlyMcpServer: {
      installed: mcpInstalled,
      available: mcpInstalled && databaseProbe.available,
      unavailabilityReason: databaseReason,
    },
    workingCopyReview: {
      installed: reviewSkillInstalled,
      available: reviewSkillInstalled && claudeAvailable && databaseProbe.available,
      unavailabilityReason: reviewReason,
    },
    sessionContextBrief: {
      installed: contextBriefInstalled,
      available: contextBriefInstalled && databaseProbe.available,
      unavailabilityReason: databaseReason,
    },
  };
}

export async function handleCapabilitiesRequest(
  request: Request,
  dependencies: CapabilityProbeDependencies,
): Promise<Response> {
  const json: unknown = await request.json().catch(() => null);
  const persisted = PersistedCapabilitiesSchema.safeParse(json);
  if (!persisted.success) {
    return Response.json({ error: "Invalid capabilities payload" }, { status: 400 });
  }

  const runtimeFacts = await probeCapabilityRuntime(dependencies);
  return Response.json(resolveServerCapabilities(persisted.data, runtimeFacts), {
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

export const Route = createFileRoute("/api/capabilities")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        return handleCapabilitiesRequest(request, {
          pathExists,
          executableExists,
          databaseAvailable,
          projectRoot: process.cwd(),
        });
      },
    }),
  },
});
