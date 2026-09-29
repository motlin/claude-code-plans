import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { readLocalAccount } from "../../lib/local-account";

export const Route = createFileRoute("/api/local-account")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => Response.json(await readLocalAccount()),
    }),
  },
});
