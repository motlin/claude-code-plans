import {
  ApplicationSettingsSchema,
  readApplicationSettings,
  updateApplicationSettings,
} from "./config";
import { rejectCrossSite } from "./same-origin-guard";

const RESPONSE_HEADERS = { "Cache-Control": "private, max-age=0, must-revalidate" };

export function handleGetApplicationSettings(configPath?: string): Response {
  return Response.json(ApplicationSettingsSchema.parse(readApplicationSettings(configPath)), {
    headers: RESPONSE_HEADERS,
  });
}

export async function handlePutApplicationSettings(
  request: Request,
  configPath?: string,
): Promise<Response> {
  const rejection = rejectCrossSite(request);
  if (rejection) return rejection;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid application settings" }, { status: 400 });
  }
  const parsed = ApplicationSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid application settings" }, { status: 400 });
  }

  const saved = await updateApplicationSettings(parsed.data, configPath);
  return Response.json(ApplicationSettingsSchema.parse(saved), { headers: RESPONSE_HEADERS });
}
