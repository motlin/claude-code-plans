import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {z} from "zod";
import {HookMutationResponse} from "../../lib/api/hooks";
import {rejectCrossSite} from "../../lib/same-origin-guard";
import {asRecord} from "../../lib/narrow";
import {
	HOOK_EVENT_NAMES,
	NEVER_INSTALLED_HOOK_EVENTS,
	generateHooksConfig,
	removeManagedHooks,
} from "../../lib/hook-config";
import {PersistedCapabilitiesSchema, capabilityIsEnabled} from "../../lib/capabilities";

const HooksMutationBody = z
	.object({
		port: z.number().optional(),
		capabilities: PersistedCapabilitiesSchema.optional(),
	})
	.strict();

async function claudeHomeJoin() {
	const {homedir} = await import("node:os");
	const {join} = await import("node:path");
	return {claudeHome: join(homedir(), ".claude"), join};
}

/**
 * Copy the settings file to `settings.json.bak` before rewriting it, so a bad
 * merge can be undone by hand. Returns undefined when there was no file.
 */
async function backupSettings(settingsPath: string, raw: string | undefined): Promise<string | undefined> {
	if (raw === undefined) return undefined;
	const {writeFile} = await import("node:fs/promises");
	const backupPath = `${settingsPath}.bak`;
	await writeFile(backupPath, raw, "utf-8");
	return backupPath;
}

async function readSettings(
	settingsPath: string,
): Promise<{raw: string | undefined; parsed: Record<string, unknown> | undefined}> {
	const {readFile} = await import("node:fs/promises");
	let raw: string | undefined;
	try {
		raw = await readFile(settingsPath, "utf-8");
	} catch {
		return {raw: undefined, parsed: undefined};
	}
	try {
		return {raw, parsed: asRecord(JSON.parse(raw))};
	} catch {
		return {raw, parsed: undefined};
	}
}

/**
 * Strip this server's commands from the named events, dropping an event left
 * with no matchers; every other event, and other tools' hooks, pass through.
 */
function stripManagedHooks(hooks: Record<string, unknown>, events: ReadonlySet<string>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(hooks).flatMap(([eventName, eventEntries]): Array<[string, unknown]> => {
			if (!events.has(eventName) || !Array.isArray(eventEntries)) return [[eventName, eventEntries]];
			const kept = removeManagedHooks(eventEntries);
			return kept.length === 0 ? [] : [[eventName, kept]];
		}),
	);
}

function mutationResponse(settingsPath: string, backupPath: string | undefined): Response {
	return Response.json(
		HookMutationResponse.parse(
			backupPath === undefined ? {ok: true, settingsPath} : {ok: true, settingsPath, backupPath},
		),
		{headers: {"Cache-Control": "private, max-age=0, must-revalidate"}},
	);
}

export const Route = createFileRoute("/api/hooks")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const rejection = rejectCrossSite(request);
				if (rejection) return rejection;

				const {claudeHome, join} = await claudeHomeJoin();
				const {writeFile, mkdir} = await import("node:fs/promises");
				const body = HooksMutationBody.parse(await request.json().catch(() => ({})));
				const settingsPath = join(claudeHome, "settings.json");
				const config = generateHooksConfig({
					...(body.port === undefined ? {} : {port: body.port}),
					includeContextBrief:
						body.capabilities !== undefined &&
						capabilityIsEnabled(body.capabilities, "sessionContextBrief"),
				});

				await mkdir(claudeHome, {recursive: true});

				// An unreadable or invalid file starts fresh; the backup keeps its bytes.
				const {raw, parsed} = await readSettings(settingsPath);
				const existing = parsed ?? {};
				const existingHooks = asRecord(existing["hooks"]) ?? {};
				for (const [eventName, matchers] of Object.entries(config.hooks)) {
					const current = existingHooks[eventName];
					existingHooks[eventName] = [
						...removeManagedHooks(Array.isArray(current) ? current : []),
						...matchers,
					];
				}
				// Forwarders an older build put under events whose hooks replace git's own
				// worktree handling must go; other tools' hooks there stay.
				existing["hooks"] = stripManagedHooks(existingHooks, new Set(NEVER_INSTALLED_HOOK_EVENTS));

				const backupPath = await backupSettings(settingsPath, raw);
				await writeFile(settingsPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
				return mutationResponse(settingsPath, backupPath);
			},
			DELETE: async ({request}: {request: Request}) => {
				const rejection = rejectCrossSite(request);
				if (rejection) return rejection;

				const {claudeHome, join} = await claudeHomeJoin();
				const {writeFile} = await import("node:fs/promises");
				const settingsPath = join(claudeHome, "settings.json");

				const {raw, parsed: existing} = await readSettings(settingsPath);
				if (existing === undefined) return mutationResponse(settingsPath, undefined);

				const managedEvents = new Set<string>([...HOOK_EVENT_NAMES, ...NEVER_INSTALLED_HOOK_EVENTS]);
				const existingHooks = asRecord(existing["hooks"]) ?? {};
				const remainingHooks = stripManagedHooks(existingHooks, managedEvents);
				const {hooks: _hooks, ...rest} = existing;
				const updated = Object.keys(remainingHooks).length === 0 ? rest : {...existing, hooks: remainingHooks};

				const backupPath = await backupSettings(settingsPath, raw);
				await writeFile(settingsPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
				return mutationResponse(settingsPath, backupPath);
			},
		}),
	},
});
