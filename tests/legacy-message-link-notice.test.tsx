// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { LegacyMessageLinkNotice } from "../src/components/legacy-message-link-notice";

afterEach(cleanup);

describe("LegacyMessageLinkNotice", () => {
  it("tells a reader arriving on an old message link that the link names nothing on the page", () => {
    render(<LegacyMessageLinkNotice hash="#msg-a2c1f0d4-6f1e-4f6c-9d1a-6f9a1c2b3d4e" />);

    expect(screen.getByRole("status").textContent).toBe(
      "This link points at one message. Sessions are addressed as a whole now, so the link named no message and the session opens from the top.",
    );
  });

  it("says the same for the uuidless rows old links addressed by record index", () => {
    render(<LegacyMessageLinkNotice hash="#msg-line-7" />);

    expect(screen.queryAllByRole("status").length).toBe(1);
  });

  it("stays out of the way of a session opened without a link to a message", () => {
    const { container } = render(<LegacyMessageLinkNotice hash="" />);
    const withOtherHash = render(<LegacyMessageLinkNotice hash="#files" />).container;

    expect({ empty: container.innerHTML, otherHash: withOtherHash.innerHTML }).toStrictEqual({
      empty: "",
      otherHash: "",
    });
  });
});
