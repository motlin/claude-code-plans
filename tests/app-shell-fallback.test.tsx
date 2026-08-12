// @vitest-environment jsdom

import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { AppShellFallback } from "../src/components/app-shell-fallback";
import { Route } from "../src/routes/__root";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    HeadContent: () => null,
    Scripts: () => null,
  };
});

// The root route owns `shellComponent`, so this markup is what the server sends
// for every route: /, /plugins, /tasks and the rest all share one shell. With
// `ssr: false` the routes themselves render nothing on the server, so the shell
// is the only thing that can paint before the client bundle hydrates.
type ShellComponent = (props: { children: ReactNode }) => ReactElement<{
  suppressHydrationWarning?: boolean;
}>;

// `Route.options` is typed as RouteOptions, which omits the root-only shell
// fields, so reaching the component the server renders needs a cast.
function getShellComponent(): ShellComponent {
  const { shellComponent } = Route.options as unknown as { shellComponent?: ShellComponent };
  if (!shellComponent) throw new Error("root route has no shellComponent");
  return shellComponent;
}

function renderServerShell(): string {
  return renderToStaticMarkup(createElement(getShellComponent(), { children: null }));
}

describe("server shell", () => {
  it("paints the app frame instead of an empty body", () => {
    const html = renderServerShell();
    const body = html.slice(html.indexOf("<body>"));

    expect({
      emptyBody: /<body>\s*<\/body>/.test(html),
      fallback: body.includes('data-testid="app-shell-fallback"'),
      sidebar: body.includes('aria-label="Sidebar"'),
      title: body.includes("Claude Code Browser"),
      skeleton: body.includes("animate-pulse"),
    }).toStrictEqual({
      emptyBody: false,
      fallback: true,
      sidebar: true,
      title: true,
      skeleton: true,
    });
  });

  it("resolves the theme before first paint so the frame is never a white flash", () => {
    const html = renderServerShell();
    const head = html.slice(0, html.indexOf("<body>"));

    expect({
      readsStoredTheme: head.includes('localStorage.getItem("theme")'),
      readsSystemTheme: head.includes("prefers-color-scheme"),
    }).toStrictEqual({
      readsStoredTheme: true,
      readsSystemTheme: true,
    });
  });

  // The theme script mutates <html> before React loads, so hydration always sees
  // attributes the server markup lacked. Without the opt-out that logs a
  // hydration error on every hard load.
  it("suppresses the hydration warning the theme script would otherwise trigger", () => {
    const document = getShellComponent()({ children: null });

    expect(document.props.suppressHydrationWarning).toStrictEqual(true);
  });
});

describe("AppShellFallback", () => {
  it("renders the frame on the server", () => {
    expect(renderToStaticMarkup(<AppShellFallback />)).toContain(
      'data-testid="app-shell-fallback"',
    );
  });

  it("removes itself once the client hydrates", () => {
    const { container } = render(<AppShellFallback />);

    expect(container.innerHTML).toStrictEqual("");
  });
});
