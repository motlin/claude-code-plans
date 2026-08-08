// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { PlanLink, selectPlanFilenames } from "../src/components/plan-link";
import { plansQueryOptions, type PlanListItem } from "../src/lib/api/plans";

const alphaPlan: PlanListItem = {
  filename: "alpha.md",
  title: "Alpha plan",
  mtime: "2000-01-01T00:00:00.000Z",
  projects: [],
};

async function renderWithRouter(
  element: React.ReactNode,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
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

describe("PlanLink", () => {
  it("renders an existing plan as a normal plan link", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(plansQueryOptions().queryKey, [alphaPlan]);

    const view = await renderWithRouter(
      <PlanLink planFilePath="/tmp/test/plans/alpha.md" />,
      queryClient,
    );
    const link = screen.getByRole("link", { name: "alpha.md" });

    expect({
      hasWarningIcon: view.container.querySelector(".lucide-triangle-alert") !== null,
      href: link.getAttribute("href"),
      missing: link.getAttribute("data-plan-missing"),
    }).toStrictEqual({ hasWarningIcon: false, href: "/plan/alpha", missing: null });
  });

  it("marks a missing plan with muted warning styling", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(plansQueryOptions().queryKey, []);

    const view = await renderWithRouter(
      <PlanLink planFilePath="/tmp/test/plans/alpha.md" />,
      queryClient,
    );
    const link = screen.getByRole("link", { name: "alpha.md" });

    expect({
      className: link.className,
      hasWarningIcon: view.container.querySelector(".lucide-triangle-alert") !== null,
      missing: link.getAttribute("data-plan-missing"),
      title: link.getAttribute("title"),
    }).toStrictEqual({
      className:
        "inline-flex items-center gap-1 font-mono max-w-xs text-text-500 opacity-60 underline decoration-dotted hover:decoration-solid",
      hasWarningIcon: true,
      missing: "true",
      title: "/tmp/test/plans/alpha.md — no plan file on disk yet",
    });
  });

  it("keeps a missing plan link navigable", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(plansQueryOptions().queryKey, []);

    await renderWithRouter(<PlanLink planFilePath="alpha.md" />, queryClient);
    const link = screen.getByRole("link", { name: "alpha.md" });

    expect({ href: link.getAttribute("href"), tagName: link.tagName }).toStrictEqual({
      href: "/plan/alpha",
      tagName: "A",
    });
  });

  it("assumes a plan exists while the cache is cold", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });

    const view = await renderWithRouter(<PlanLink planFilePath="alpha.md" />, queryClient);
    const link = screen.getByRole("link", { name: "alpha.md" });

    expect({
      hasWarningIcon: view.container.querySelector(".lucide-triangle-alert") !== null,
      missing: link.getAttribute("data-plan-missing"),
    }).toStrictEqual({ hasWarningIcon: false, missing: null });
  });

  it("applies the markdown slug conversion exactly once", async () => {
    const filename = "2026-04-21-my-plan.md";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(plansQueryOptions().queryKey, [
      { ...alphaPlan, filename, title: "Dated plan" },
    ]);

    await renderWithRouter(<PlanLink planFilePath={`/tmp/test/plans/${filename}`} />, queryClient);
    const href = screen.getByRole("link", { name: filename }).getAttribute("href");

    expect({ containsMarkdownExtension: href?.includes(".md"), href }).toStrictEqual({
      containsMarkdownExtension: false,
      href: "/plan/2026-04-21-my-plan",
    });
  });

  it("updates when a missing plan appears in the cache", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(plansQueryOptions().queryKey, []);

    await renderWithRouter(<PlanLink planFilePath="alpha.md" />, queryClient);
    const link = screen.getByRole("link", { name: "alpha.md" });
    expect(link.getAttribute("data-plan-missing")).toBe("true");

    act(() => {
      queryClient.setQueryData(plansQueryOptions().queryKey, [alphaPlan]);
    });

    await waitFor(() => expect(link.getAttribute("data-plan-missing")).toBeNull());
  });
});

describe("selectPlanFilenames", () => {
  it("memoizes by source array identity", () => {
    const plans = [alphaPlan];
    const first = selectPlanFilenames(plans);
    const repeated = selectPlanFilenames(plans);
    const replaced = selectPlanFilenames([...plans]);

    expect(repeated).toBe(first);
    expect(replaced).not.toBe(first);
  });
});
