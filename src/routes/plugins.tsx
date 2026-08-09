import { createFileRoute } from "@tanstack/react-router";
import { pluginsQueryOptions, userCommandsQueryOptions } from "../lib/api/plugins";
import { PluginsPage } from "../components/plugins-page";

export const Route = createFileRoute("/plugins")({
  component: PluginsPage,
  // Warm the caches without blocking render: the shell and skeleton must
  // paint before the ~170 KB plugins payload arrives (the app is
  // client-rendered, so a blocking loader means a blank white screen).
  loader: ({ context: { queryClient } }) => {
    void queryClient.prefetchQuery(pluginsQueryOptions);
    void queryClient.prefetchQuery(userCommandsQueryOptions);
  },
  head: () => ({
    meta: [{ title: "Claude Plugins" }],
  }),
});
