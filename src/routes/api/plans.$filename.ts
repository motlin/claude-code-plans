import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {PlanDetailResponse} from "../../lib/api/plans";
import {fromMdSlug} from "../../lib/md-slug";
import {rejectCrossSite} from "../../lib/same-origin-guard";
import {filesEtag, notModifiedResponse, validatorHeaders} from "../../lib/conditional-get";

export const Route = createFileRoute("/api/plans/$filename")(
	{
		server:
		{
			handlers: withMethodNotAllowed(
				{
					GET: async ({
						params,
						request,
					}: {
						params:
						{
							filename: string;
						};
						request: Request;
					}) =>
					{
						const {homedir} = await import("node:os");
						const {join} = await import("node:path");
						const {stat} = await import("node:fs/promises");
						const {resolveMarkdownFilePath} = await import("../../lib/markdown-file-path");
						const {readPlan} = await import("../../lib/plans");
						const {extractTitleFromContent} = await import("../../lib/markdown-utils");

						const plansDir = join(homedir(), ".claude", "plans");
						const filename = fromMdSlug(params.filename);
						const filePath = resolveMarkdownFilePath(plansDir, filename);
						if (filePath === null)
						{
							return new Response(
								"Not Found",
								{
									status: 404,
								},
							);
						}

						const fileStat = await stat(filePath).catch(() => null);
						if (fileStat === null)
						{
							return new Response(
								"Not Found",
								{
									status: 404,
								},
							);
						}
						const etag = filesEtag([fileStat]);
						const notModified = notModifiedResponse(request, etag);
						if (notModified) return notModified;

						const markdown = await readPlan(plansDir, filename);
						if (markdown == null)
						{
							return new Response(
								"Not Found",
								{
									status: 404,
								},
							);
						}

						const title = extractTitleFromContent(markdown, filename);
						const mtime = fileStat.mtime;
						const headers = validatorHeaders(etag);

						return Response.json(
							PlanDetailResponse.parse(
								{
									markdown,
									mtime: mtime.toISOString(),
									title,
								},
							),
							{
								headers,
							},
						);
					},
					PUT: async ({
						params,
						request,
					}: {
						params:
						{
							filename: string;
						};
						request: Request;
					}) =>
					{
						const rejection = rejectCrossSite(request);
						if (rejection) return rejection;

						const {homedir} = await import("node:os");
						const {join} = await import("node:path");
						const {writePlan} = await import("../../lib/plans");
						const {extractTitleFromContent} = await import("../../lib/markdown-utils");
						const {resolveMarkdownFilePath} = await import("../../lib/markdown-file-path");
						const {rejectStaleWrite, savedFileHeaders} = await import("../../lib/file-edit-server");

						const plansDir = join(homedir(), ".claude", "plans");
						const filename = fromMdSlug(params.filename);
						const filePath = resolveMarkdownFilePath(plansDir, filename);
						if (filePath === null)
						{
							return new Response(
								"Not Found",
								{
									status: 404,
								},
							);
						}
						const conflict = await rejectStaleWrite(request, filePath);
						if (conflict) return conflict;

						const markdown = await request.text();
						const ok = await writePlan(plansDir, filename, markdown);
						if (!ok)
						{
							return new Response(
								"Not Found",
								{
									status: 404,
								},
							);
						}

						const title = extractTitleFromContent(markdown, filename);

						return Response.json(
							{
								title,
							},
							{
								headers: await savedFileHeaders(filePath),
							},
						);
					},
				},
			),
		},
	},
);
