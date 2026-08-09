import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/count")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { listPlans } = await import("../../lib/plans");
        const plansDir = join(homedir(), ".claude", "plans");
        const plans = await listPlans(plansDir);
        return Response.json({ count: plans.length });
      },
    }),
  },
});
