import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {z} from "zod";
import {HookMutationResponse} from "../../lib/api/hooks";
import {rejectCrossSite} from "../../lib/same-origin-guard";
import {asRecord, isRecord} from "../../lib/narrow";
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

function containsManagedHook(entry: unknown): boolean {
	const hooks = isRecord(entry) ? entry["hooks"] : undefined;
	if (!Array.isArray(hooks)) return false;
	return hooks.some((hook: unknown) => {
		const command = isRecord(hook) ? hook["command"] : undefined;
		return typeof command === "string" && (command.includes("/api/hook") || command.includes("/api/context-brief"));
	});
}

export const Route = createFileRoute("/api/hooks")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const rejection = rejectCrossSite(request);
				if (rejection) return rejection;

				const {claudeHome, join} = await claudeHomeJoin();
				const {generateHooksConfig} = await import("../../lib/hook-config");
				const {readFile, writeFile, mkdir} = await import("node:fs/promises");
				const body = HooksMutationBody.parse(await request.json().catch(() => ({})));
				const settingsPath = join(claudeHome, "settings.json");
				const config = generateHooksConfig({
					...(body.port === undefined ? {} : {port: body.port}),
					includeContextBrief:
						body.capabilities !== undefined &&
						capabilityIsEnabled(body.capabilities, "sessionContextBrief"),
				});

				await mkdir(claudeHome, {recursive: true});

				let existing: Record<string, unknown> = {};
				try {
					const raw = await readFile(settingsPath, "utf-8");
					existing = asRecord(JSON.parse(raw)) ?? {};
				} catch {
					// File doesn't exist or is invalid — start fresh
				}

				const existingHooks = asRecord(existing["hooks"]) ?? {};
				for (const [eventName, matchers] of Object.entries(config.hooks)) {
					const current = existingHooks[eventName];
					const eventEntries = Array.isArray(current) ? Array.from<unknown>(current) : [];

					const filtered = eventEntries.filter((entry) => !containsManagedHook(entry));

					filtered.push(...matchers);
					existingHooks[eventName] = filtered;
				}

				existing["hooks"] = existingHooks;

				await writeFile(settingsPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
				return Response.json(HookMutationResponse.parse({ok: true, settingsPath}), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
			DELETE: async ({request}: {request: Request}) => {
				const rejection = rejectCrossSite(request);
				if (rejection) return rejection;

				const {claudeHome, join} = await claudeHomeJoin();
				const {generateHooksConfig} = await import("../../lib/hook-config");
				const {readFile, writeFile} = await import("node:fs/promises");
				let body: z.infer<typeof HooksMutationBody> = {};
				try {
					body = HooksMutationBody.parse(await request.json());
				} catch {
					body = {};
				}
				const settingsPath = join(claudeHome, "settings.json");
				const config = generateHooksConfig({
					...(body.port === undefined ? {} : {port: body.port}),
					includeContextBrief: true,
				});

				let existing: Record<string, unknown> | undefined;
				try {
					const raw = await readFile(settingsPath, "utf-8");
					existing = asRecord(JSON.parse(raw));
				} catch {
					existing = undefined;
				}
				if (existing === undefined) {
					return Response.json(HookMutationResponse.parse({ok: true, settingsPath}), {
						headers: {
							"Cache-Control": "private, max-age=0, must-revalidate",
						},
					});
				}

				const managedEvents = new Set(Object.keys(config.hooks));
				const existingHooks = asRecord(existing["hooks"]) ?? {};
				const remainingHooks = Object.fromEntries(
					Object.entries(existingHooks).flatMap(([eventName, eventEntries]): Array<[string, unknown]> => {
						if (!managedEvents.has(eventName) || !Array.isArray(eventEntries))
							return [[eventName, eventEntries]];
						const kept = eventEntries.filter((entry) => !containsManagedHook(entry));
						return kept.length === 0 ? [] : [[eventName, kept]];
					}),
				);
				const {hooks: _hooks, ...rest} = existing;
				const updated = Object.keys(remainingHooks).length === 0 ? rest : {...existing, hooks: remainingHooks};

				await writeFile(settingsPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
				return Response.json(HookMutationResponse.parse({ok: true, settingsPath}), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
