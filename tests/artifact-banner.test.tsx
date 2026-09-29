import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactLinkBanner, ArtifactWatchBanner } from "../src/components/artifact-banner";

const url = "https://claude.ai/code/artifact/29d89ae8-e33b-4f55-bbbd-874d5d316169";

/** The artifact link cards in `html`, as [href, title] pairs. */
function cards(html: string): [string, string][] {
  return Array.from(
    html.matchAll(
      /<a href="([^"]*)"[^>]*class="artifact-link-card"[^>]*><span class="artifact-link-card-title">([^<]*)<\/span>/g,
    ),
    ([, href, title]) => [href!, title!],
  );
}

describe("ArtifactLinkBanner", () => {
  it("links out to the published artifact as a link card", () => {
    const html = renderToStaticMarkup(
      <ArtifactLinkBanner
        line={{
          type: "artifact-link",
          frameUrl: url,
          title: "Quarto Oracle",
          path: "/tmp/test/page.html",
          lineIndex: 0,
        }}
      />,
    );
    expect(cards(html)).toStrictEqual([[url, "Quarto Oracle"]]);
    expect(html).toContain("Published artifact");
    expect(html).toContain("/tmp/test/page.html");
  });

  it("titles an untitled artifact with its URL", () => {
    const html = renderToStaticMarkup(
      <ArtifactLinkBanner line={{ type: "artifact-link", frameUrl: url, lineIndex: 0 }} />,
    );
    expect(cards(html)).toStrictEqual([[url, url]]);
  });
});

describe("ArtifactWatchBanner", () => {
  it("lists each watched artifact with non-default state and comment threads", () => {
    const html = renderToStaticMarkup(
      <ArtifactWatchBanner
        line={{
          type: "artifact-watch",
          artifacts: [
            { url, title: "Quarto Oracle", state: "armed", commentThreads: 1 },
            { url: "https://claude.ai/artifact/some-slug", state: "paused" },
          ],
          lineIndex: 0,
        }}
      />,
    );
    expect(html).toContain("Watching for comments");
    expect(cards(html)).toStrictEqual([
      [url, "Quarto Oracle"],
      ["https://claude.ai/artifact/some-slug", "https://claude.ai/artifact/some-slug"],
    ]);
    expect(html).toContain("1 comment thread<");
    expect(html).toContain(">paused<");
    expect(html).not.toContain("armed");
  });
});
