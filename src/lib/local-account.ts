import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { ClaudeJsonOauthAccountSchema } from "./schemas";

type OauthAccount = z.infer<typeof ClaudeJsonOauthAccountSchema>;

const OAUTH_ACCOUNT_KEYS = [
  "displayName",
  "fullName",
  "emailAddress",
  "organizationType",
  "organizationRateLimitTier",
] as const;

/** The signed-in Claude account as recorded locally by the CLI. */
export interface LocalAccount {
  name: string;
  firstName: string;
  initial: string;
  email?: string;
  /** Short plan name for the footer suffix, e.g. "Max". */
  planLabel?: string;
  /** Plan name with its rate tier, e.g. "Max (20x)". */
  planDetail?: string;
}

export interface ReadLocalAccountOptions {
  /** Directory holding .claude.json. Defaults to the user's home. */
  home?: string;
  /** Fallback name when .claude.json has no display or full name. */
  username?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function osUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

async function readOauthAccount(home: string): Promise<OauthAccount> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(home, ".claude.json"), "utf-8"));
  } catch {
    return {};
  }
  if (!isRecord(raw) || !isRecord(raw["oauthAccount"])) return {};
  const account = raw["oauthAccount"];
  const picked: Record<string, unknown> = {};
  for (const key of OAUTH_ACCOUNT_KEYS) {
    if (key in account) picked[key] = account[key];
  }
  const parsed = ClaudeJsonOauthAccountSchema.safeParse(picked);
  return parsed.success ? parsed.data : {};
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function plan(account: OauthAccount): { label: string; detail: string } | undefined {
  switch (account.organizationType) {
    case "claude_max": {
      const multiplier = /_(\d+x)$/.exec(account.organizationRateLimitTier ?? "")?.[1];
      return { label: "Max", detail: multiplier ? `Max (${multiplier})` : "Max" };
    }
    case "claude_pro":
      return { label: "Pro", detail: "Pro" };
    default:
      return undefined;
  }
}

export async function readLocalAccount({
  home = homedir(),
  username = osUsername(),
}: ReadLocalAccountOptions = {}): Promise<LocalAccount> {
  const account = await readOauthAccount(home);
  const displayName = nonEmpty(account.displayName);
  const fullName = nonEmpty(account.fullName);
  const name = displayName ?? fullName ?? username;
  const firstName = displayName ?? fullName?.split(/\s+/)[0] ?? name;

  const result: LocalAccount = {
    name,
    firstName,
    initial: name.charAt(0).toUpperCase(),
  };
  const email = nonEmpty(account.emailAddress);
  if (email !== undefined) result.email = email;
  const planInfo = plan(account);
  if (planInfo !== undefined) {
    result.planLabel = planInfo.label;
    result.planDetail = planInfo.detail;
  }
  return result;
}

export const getLocalAccount = createServerFn({ method: "GET" }).handler(() => readLocalAccount());
