import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";

import {listOutputStyles} from "./output-styles";
import {parseFrontmatter} from "./plugins";
import {rejectCrossSite} from "./same-origin-guard";
import {defaultClaudeDir, SETTINGS_RESPONSE_HEADERS} from "./settings-file";

/*
 * Upstream's desktop `createOutputStyle` IPC, for local sessions: Claude drafts a style from a description and it is
 * saved as `~/.claude/output-styles/<slug>.md`. A running CLI only picks it up in its next session, so a created style
 * is never `refreshed` or `selected`.
 */

export type OutputStyleNameCheck = "ok" | "exists" | "invalid";

const STYLE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u;

/** Plain words only, never "default" (the CLI's own style), and unique case-insensitively. */
export function validateOutputStyleName(name: string, existing: readonly string[]): OutputStyleNameCheck
{
	const trimmed = name.trim();
	if (!STYLE_NAME.test(trimmed) || trimmed.toLowerCase() === "default") return "invalid";
	const folded = trimmed.toLowerCase();
	return existing.some((other) => other.toLowerCase() === folded) ? "exists" : "ok";
}

/** The style's file name: lowercase, whitespace runs as `-`. */
export function outputStyleSlug(name: string): string
{
	return name.trim().toLowerCase().replaceAll(/\s+/g, "-");
}

export type OutputStyleCreateFailure =
	| "name_exists"
	| "name_invalid"
	| "draft_failed"
	| "write_failed"
	| "busy_creating"
	| "cancelled";

export type OutputStyleCreateResult =
	|
	  {
			outcome: "created";
			name: string;
			path: string;
			refreshed: false;
			selected: false;
	  }
	|
	  {
			outcome: OutputStyleCreateFailure;
	  };

export type OutputStyleDraft = (prompt: string, signal: AbortSignal) => Promise<string>;

export interface CreateOutputStyleOptions
{
	claudeDir: string;
	description: string;
	name?: string;
	signal: AbortSignal;
	draft?: OutputStyleDraft;
}

const defaultDraft: OutputStyleDraft = async (prompt, signal) =>
{
	const {runClaude} = await import("./summaries");
	return runClaude(
		prompt,
		{
			signal,
		},
	);
};

function draftPrompt(description: string, name: string | undefined): string
{
	return [
		"Write a Claude Code output style file. Output only the file's contents: YAML frontmatter with `name` (a short title of one to three plain words) and `description` (one sentence), then a markdown body of instructions telling Claude how to write its responses in this style.",
		...(name === undefined ? [] : [`The name must be exactly: ${name}`]),
		"The style the user described:",
		description,
	].join("\n\n");
}

/** The draft without a surrounding code fence, as models sometimes wrap a file. */
function unfence(text: string): string
{
	const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text.trim());
	return fenced?.[1] ?? text.trim();
}

function unquote(value: string): string
{
	return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/** An unnamed draft's own name, suffixed `2`, `3`, … until no style has it. */
function freeName(base: string, existing: readonly string[]): string | undefined
{
	if (validateOutputStyleName(base, existing) === "ok") return base;
	for (let suffix = 2; suffix < 100; suffix += 1)
	{
		const candidate = `${base} ${suffix}`;
		if (validateOutputStyleName(candidate, existing) === "ok") return candidate;
	}
	return undefined;
}

let creating = false;

export async function createOutputStyle({
	claudeDir,
	description,
	name,
	signal,
	draft = defaultDraft,
}: CreateOutputStyleOptions): Promise<OutputStyleCreateResult>
{
	if (creating)
		return {
			outcome: "busy_creating",
		};
	creating = true;
	try
	{
		const styles = await listOutputStyles(claudeDir, []);
		const existing = ["default", ...styles.builtIns, ...styles.customs];
		const trimmedName = name?.trim() ?? "";
		const requested = trimmedName === "" ? undefined : trimmedName;
		if (requested !== undefined)
		{
			const check = validateOutputStyleName(requested, existing);
			if (check !== "ok")
				return {
					outcome: check === "exists" ? "name_exists" : "name_invalid",
				};
		}

		let text: string;
		try
		{
			text = unfence(await draft(draftPrompt(description, requested), signal));
		}
		catch
		{
			return {
				outcome: signal.aborted ? "cancelled" : "draft_failed",
			};
		}
		if (signal.aborted)
			return {
				outcome: "cancelled",
			};

		const {frontmatter, body} = parseFrontmatter(text);
		const finalName = requested ?? freeName(unquote(frontmatter["name"] ?? "").trim(), existing);
		const instructions = body.trim();
		if (finalName === undefined || instructions.length === 0)
			return {
				outcome: "draft_failed",
			};
		const summary = unquote(frontmatter["description"] ?? "").trim() || description.split("\n", 1)[0]?.trim();
		const dir = join(claudeDir, "output-styles");
		const path = join(dir, `${outputStyleSlug(finalName)}.md`);
		try
		{
			await mkdir(
				dir,
				{
					recursive: true,
				},
			);
			await writeFile(
				path,
				`---\nname: ${finalName}\ndescription: ${JSON.stringify(summary ?? "")}\n---\n\n${instructions}\n`,
				{
					flag: "wx",
				},
			);
		}
		catch (error)
		{
			return {
				outcome:
					error instanceof Error && "code" in error && error.code === "EEXIST"
						? "name_exists"
						: "write_failed",
			};
		}
		return {
			outcome: "created",
			name: finalName,
			path,
			refreshed: false,
			selected: false,
		};
	}
	finally
	{
		creating = false;
	}
}

const CreateRequestSchema = z.strictObject(
	{
		description: z.string().trim().min(1).max(2000),
		name: z.string().max(200).optional(),
	},
);

const ValidateRequestSchema = z.strictObject(
	{
		name: z.string().max(200),
	},
);

function badRequest(error: z.ZodError): Response
{
	return Response.json(
		{
			error: z.prettifyError(error),
		},
		{
			status: 400,
		},
	);
}

/** `POST /api/output-styles` `{description, name?}`: drafts and saves a style; aborting the request cancels the draft. */
export async function handleOutputStyleCreate(
	request: Request,
	claudeDir: string = defaultClaudeDir(),
	draft?: OutputStyleDraft,
): Promise<Response>
{
	const crossSite = rejectCrossSite(request);
	if (crossSite !== null) return crossSite;
	const parsed = CreateRequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return badRequest(parsed.error);
	const result = await createOutputStyle(
		{
			claudeDir,
			description: parsed.data.description,
			...(parsed.data.name === undefined
				? {}
				:
					{
						name: parsed.data.name,
					}),
			signal: request.signal,
			...(draft === undefined
				? {}
				:
					{
						draft,
					}),
		},
	);
	return Response.json(
		result,
		{
			headers: SETTINGS_RESPONSE_HEADERS,
		},
	);
}

/** `POST /api/output-styles/validate` `{name}` → `{ok:true}` or `{ok:false, reason:"exists"|"invalid"}`. */
export async function handleOutputStyleValidate(
	request: Request,
	claudeDir: string = defaultClaudeDir(),
): Promise<Response>
{
	const crossSite = rejectCrossSite(request);
	if (crossSite !== null) return crossSite;
	const parsed = ValidateRequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return badRequest(parsed.error);
	const styles = await listOutputStyles(claudeDir, []);
	const check = validateOutputStyleName(parsed.data.name, ["default", ...styles.builtIns, ...styles.customs]);
	return Response.json(
		check === "ok"
			?
				{
					ok: true,
				}
			:
				{
					ok: false,
					reason: check,
				},
		{
			headers: SETTINGS_RESPONSE_HEADERS,
		},
	);
}
