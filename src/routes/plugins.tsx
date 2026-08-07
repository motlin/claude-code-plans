import { createFileRoute } from "@tanstack/react-router";
import { pluginsQueryOptions, userCommandsQueryOptions } from "../lib/api/plugins";
import { PluginsPage } from "../components/plugins-page";

export const Route = createFileRoute("/plugins")({
  component: PluginsPage,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(pluginsQueryOptions),
      queryClient.ensureQueryData(userCommandsQueryOptions),
    ]),
  head: () => ({
    meta: [{ title: "Claude Plugins" }],
  }),
});
