import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Plugins moved under Customize. `/plugins#<id>` (the old sidebar deep link)
 * lands on that plugin's detail page.
 */
export function redirectLegacyPlugins({ location }: { location: { hash: string } }): never {
  if (location.hash === "") throw redirect({ to: "/customize/plugins", replace: true });
  throw redirect({
    to: "/customize/plugins/id/$pluginId",
    params: { pluginId: location.hash },
    replace: true,
  });
}

export const Route = createFileRoute("/plugins")({
  beforeLoad: redirectLegacyPlugins,
});
