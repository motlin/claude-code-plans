import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SettingsResponse} from "../../lib/api/settings";
import {type FileVersion, filesEtag, notModifiedResponse, validatorHeaders} from "../../lib/conditional-get";

const SETTINGS_FILENAMES = ["settings.json", "settings.local.json"] as const;

export const Route = createFileRoute("/api/settings")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({request}: {request: Request}) =>
					{
						const {homedir} = await import("node:os");
						const {join} = await import("node:path");
						const {readFile, stat} = await import("node:fs/promises");
						const claudeHome = join(homedir(), ".claude");

						const results: Array<
						{
							filename: string;
							path: string;
							exists: boolean;
							content: string;
						}> = [];
						const versions: Array<FileVersion | null> = [];

						for (const filename of SETTINGS_FILENAMES)
						{
							const filePath = join(claudeHome, filename);
							versions.push(await stat(filePath).catch(() => null));
							try
							{
								const raw = await readFile(filePath, "utf-8");
								const pretty = JSON.stringify(JSON.parse(raw), null, 2);
								results.push(
									{
										filename,
										path: filePath,
										exists: true,
										content: pretty,
									},
								);
							}
							catch
							{
								results.push(
									{
										filename,
										path: filePath,
										exists: false,
										content: "{}",
									},
								);
							}
						}

						const etag = filesEtag(versions);
						const notModified = notModifiedResponse(request, etag);
						if (notModified) return notModified;

						return Response.json(
							SettingsResponse.parse(results),
							{
								headers: validatorHeaders(etag),
							},
						);
					},
				},
			),
		},
	},
);
