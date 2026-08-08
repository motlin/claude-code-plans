// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { AttachmentBanner } from "../src/components/attachment-banner";
import { plansQueryOptions, type PlanListItem } from "../src/lib/api/plans";

const planFilePath = "/Users/craig/.claude/plans/alpha.md";
const alphaPlan: PlanListItem = {
  filename: "alpha.md",
  title: "Alpha plan",
  mtime: "2000-01-01T00:00:00.000Z",
  projects: [],
};
const planModeCases = [
  { label: "Plan mode", type: "plan_mode" },
  { label: "Re-entered plan mode", type: "plan_mode_reentry" },
  { label: "Plan file", type: "plan_file_reference" },
] as const;

async function renderWithRouter(element: React.ReactNode, queryClient: QueryClient) {
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

afterEach(cleanup);

describe("AttachmentBanner plan links", () => {
  for (const { type } of planModeCases) {
    it(`links an existing plan from ${type}`, async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(plansQueryOptions().queryKey, [alphaPlan]);

      const view = await renderWithRouter(
        <AttachmentBanner attachmentJson={JSON.stringify({ type, planFilePath })} />,
        queryClient,
      );
      const anchors = [...view.container.querySelectorAll("a")].map((anchor) => ({
        href: anchor.getAttribute("href"),
        title: anchor.getAttribute("title"),
      }));

      expect(anchors).toStrictEqual([{ href: "/plan/alpha", title: planFilePath }]);
    });

    it(`marks a missing plan from ${type}`, async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(plansQueryOptions().queryKey, []);

      const view = await renderWithRouter(
        <AttachmentBanner attachmentJson={JSON.stringify({ type, planFilePath })} />,
        queryClient,
      );
      const anchors = [...view.container.querySelectorAll("a")].map((anchor) => ({
        missing: anchor.getAttribute("data-plan-missing"),
      }));

      expect({
        anchors,
        warningIconCount: view.container.querySelectorAll(".lucide-triangle-alert").length,
      }).toStrictEqual({ anchors: [{ missing: "true" }], warningIconCount: 1 });
    });
  }

  it("preserves the plan-mode banner labels", async () => {
    const labels = [];

    for (const { label, type } of planModeCases) {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(plansQueryOptions().queryKey, [alphaPlan]);
      const view = await renderWithRouter(
        <AttachmentBanner attachmentJson={JSON.stringify({ type, planFilePath })} />,
        queryClient,
      );
      labels.push(view.getByText(label).textContent);
      view.unmount();
    }

    expect(labels).toStrictEqual(["Plan mode", "Re-entered plan mode", "Plan file"]);
  });
});
