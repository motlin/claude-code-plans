/**
 * A `#msg-<uuid>` fragment: the shape this viewer used to give a single message
 * before session URLs were brought in line with upstream claude.ai/code, which
 * addresses a session and nothing finer. `line-<n>` fragments, which named the
 * records carrying no uuid of their own, match too.
 */
const LEGACY_MESSAGE_LINK = /^#?msg-[A-Za-z0-9_-]+$/;

function isLegacyMessageLink(hash: string): boolean {
  return LEGACY_MESSAGE_LINK.test(hash);
}

/**
 * What a link copied before message anchors were dropped now lands on.
 *
 * Such a link opens the session at the top, which looks exactly like a link to
 * the session's first message. Saying so is the difference between a link that
 * failed and a link that quietly showed the reader the wrong message.
 */
export function LegacyMessageLinkNotice({ hash }: { hash: string }) {
  if (!isLegacyMessageLink(hash)) return null;

  return (
    <div
      role="status"
      className="mb-3 rounded-r7 border border-strong bg-surface-0 px-3 py-2 text-[12px] text-secondary"
    >
      This link points at one message. Sessions are addressed as a whole now, so the link named no
      message and the session opens from the top.
    </div>
  );
}
