import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {MemoryDeleteResponse, MemoryDetailResponse, MemorySaveResponse} from "../../lib/api/memories";
import {fromMdSlug} from "../../lib/md-slug";
import {rejectCrossSite} from "../../lib/same-origin-guard";
import {filesEtag, notModifiedResponse, validatorHeaders} from "../../lib/conditional-get";

export const Route = createFileRoute("/api/projects/$id/memories/$filename")(
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
							id: string;
							filename: string;
						};
						request: Request;
					}) =>
					{
						const {homedir} = await import("node:os");
						const {join} = await import("node:path");
						const {stat} = await import("node:fs/promises");
						const {resolveMarkdownFilePath} = await import("../../lib/markdown-file-path");
						const {readMemory, decodeProjectDir} = await import("../../lib/memory");

						const projectsDir = join(homedir(), ".claude", "projects");
						const filename = fromMdSlug(params.filename);
						if (params.id.includes("..") || params.id.includes("/"))
						{
							return new Response(
								"Not Found",
								{
									status: 404,
								},
							);
						}
						const memoryDir = join(projectsDir, params.id, "memory");
						const filePath = resolveMarkdownFilePath(memoryDir, filename);
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
						const etag = fileStat === null ? null : filesEtag([fileStat]);
						if (etag !== null)
						{
							const notModified = notModifiedResponse(request, etag);
							if (notModified) return notModified;
						}

						const content = await readMemory(projectsDir, params.id, filename);
						if (content === null)
						{
							return Response.json(
								MemoryDetailResponse.parse(null),
								{
									headers:
									{
										"Cache-Control": "private, max-age=0, must-revalidate",
									},
								},
							);
						}

						const projectName = decodeProjectDir(params.id);
						const mtime = fileStat?.mtime ?? null;
						const headers =
							etag === null
								?
									{
										"Cache-Control": "private, max-age=0, must-revalidate",
									}
								: validatorHeaders(etag);

						return Response.json(
							MemoryDetailResponse.parse(
								{
									markdown: content,
									mtime: mtime ? mtime.toISOString() : null,
									projectName,
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
							id: string;
							filename: string;
						};
						request: Request;
					}) =>
					{
						const rejection = rejectCrossSite(request);
						if (rejection) return rejection;

						const {homedir} = await import("node:os");
						const {join} = await import("node:path");
						const {writeMemory} = await import("../../lib/memory");
						const {resolveMarkdownFilePath} = await import("../../lib/markdown-file-path");
						const {rejectStaleWrite, savedFileHeaders} = await import("../../lib/file-edit-server");
						const projectsDir = join(homedir(), ".claude", "projects");
						const filename = fromMdSlug(params.filename);
						const filePath =
							params.id.includes("..") || params.id.includes("/")
								? null
								: resolveMarkdownFilePath(join(projectsDir, params.id, "memory"), filename);
						if (filePath === null)
						{
							return new Response(
								"Invalid path",
								{
									status: 400,
								},
							);
						}
						const conflict = await rejectStaleWrite(request, filePath);
						if (conflict) return conflict;

						const content = await request.text();
						const ok = await writeMemory(projectsDir, params.id, filename, content);
						if (!ok)
						{
							return new Response(
								"Invalid path",
								{
									status: 400,
								},
							);
						}
						return Response.json(
							MemorySaveResponse.parse(
								{
									ok,
								},
							),
							{
								headers: await savedFileHeaders(filePath),
							},
						);
					},
					DELETE: async ({
						params,
						request,
					}: {
						params:
						{
							id: string;
							filename: string;
						};
						request: Request;
					}) =>
					{
						const rejection = rejectCrossSite(request);
						if (rejection) return rejection;

						const {homedir} = await import("node:os");
						const {join} = await import("node:path");
						const {deleteMemory} = await import("../../lib/memory");
						const projectsDir = join(homedir(), ".claude", "projects");
						const ok = await deleteMemory(projectsDir, params.id, fromMdSlug(params.filename));
						return Response.json(
							MemoryDeleteResponse.parse(
								{
									ok,
								},
							),
							{
								headers:
								{
									"Cache-Control": "private, max-age=0, must-revalidate",
								},
							},
						);
					},
				},
			),
		},
	},
);
