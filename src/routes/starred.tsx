import { createFileRoute } from "@tanstack/react-router";
import { StarredSessionsPage } from "../components/starred-sessions-page";

export const Route = createFileRoute("/starred")({
  component: StarredSessionsPage,
  head: () => ({
    meta: [{ title: "Starred Sessions" }],
  }),
});
