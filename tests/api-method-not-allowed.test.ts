import { describe, expect, it } from "vite-plus/test";
import { Route as CapabilitiesRoute } from "../src/routes/api/capabilities";
import { Route as HooksRoute } from "../src/routes/api/hooks";
import { Route as ReviewRoute } from "../src/routes/api/sessions.$id.review";
import { Route as SummaryRoute } from "../src/routes/api/sessions.$id.summary";
import { Route as SettingsFileRoute } from "../src/routes/api/settings.$filename";

type ApiHandler = (context: { request: Request }) => Response | Promise<Response>;

function routeHandlers(route: unknown): Record<string, ApiHandler | undefined> {
  return (route as { options: { server: { handlers: Record<string, ApiHandler | undefined> } } })
    .options.server.handlers;
}

/**
 * Mirrors handler resolution in @tanstack/start-server-core createStartHandler:
 * HEAD falls back to GET then ANY; every other method falls back to ANY.
 */
function resolveHandler(route: unknown, method: string): ApiHandler | undefined {
  const handlers = routeHandlers(route);
  if (method === "HEAD") return handlers["HEAD"] ?? handlers["GET"] ?? handlers["ANY"];
  return handlers[method] ?? handlers["ANY"];
}

async function describeResponse(response: Response): Promise<{
  allow: string | null;
  body: unknown;
  contentType: string | null;
  status: number;
}> {
  return {
    allow: response.headers.get("Allow"),
    body: await response.json(),
    contentType: response.headers.get("Content-Type"),
    status: response.status,
  };
}

describe("GET on API routes without a GET handler", () => {
  const cases: Array<{ allow: string; path: string; route: unknown }> = [
    { allow: "DELETE, POST", path: "/api/hooks", route: HooksRoute },
    { allow: "POST", path: "/api/capabilities", route: CapabilitiesRoute },
    { allow: "PUT", path: "/api/settings/settings.json", route: SettingsFileRoute },
    { allow: "POST", path: "/api/sessions/$id/summary", route: SummaryRoute },
    { allow: "POST", path: "/api/sessions/$id/review", route: ReviewRoute },
  ];

  for (const { allow, path, route } of cases) {
    it(`${path} yields 405 with Allow: ${allow}`, async () => {
      const handler = resolveHandler(route, "GET");
      expect(handler).toBeDefined();

      const request = new Request(`http://localhost${path}`, { method: "GET" });
      const response = await handler!({ request });

      expect(await describeResponse(response)).toStrictEqual({
        allow,
        body: { error: "Method Not Allowed" },
        contentType: "application/json",
        status: 405,
      });
    });
  }
});

describe("every /api route", () => {
  const modules = import.meta.glob("../src/routes/api/*.ts", { eager: true });

  it("declares handlers for every HTTP method so no method falls through to the HTML shell", () => {
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
    const uncovered: string[] = [];

    for (const [file, mod] of Object.entries(modules)) {
      const route = (mod as { Route?: unknown }).Route;
      expect(route, `${file} must export Route`).toBeDefined();
      for (const method of methods) {
        if (resolveHandler(route, method) === undefined) {
          uncovered.push(`${file} ${method}`);
        }
      }
    }

    expect(uncovered).toStrictEqual([]);
  });
});
