import { Terminal } from "lucide-react";

const SIZE = {
  /** Table rows and the detail header: 24px tile, 16px glyph. */
  sm: { tile: "size-6 rounded-[6.48px]", glyph: 16 },
  /** Detail header. */
  lg: { tile: "size-9 rounded-r6", glyph: 20 },
} as const;

/** The host of an http/sse server URL, used for its favicon. */
export function connectorDomain(transport: string, urlOrCommand: string): string | null {
  if (transport === "stdio") return null;
  try {
    return new URL(urlOrCommand).hostname || null;
  } catch {
    return null;
  }
}

interface ConnectorTileProps {
  name: string;
  domain: string | null;
  size?: keyof typeof SIZE;
}

/**
 * Upstream connector tile: a bordered surface-0 square holding the Google s2
 * favicon for the server's domain. Local stdio servers have no domain, so they
 * show a terminal glyph instead.
 */
export function ConnectorTile({ name, domain, size = "sm" }: ConnectorTileProps) {
  const { tile, glyph } = SIZE[size];
  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-border bg-surface-0 text-secondary shadow-sm ${tile}`}
    >
      {domain === null ? (
        <Terminal aria-hidden="true" size={glyph - 2} />
      ) : (
        <img
          width={glyph}
          height={glyph}
          alt={`${name} icon`}
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
          style={{ maxWidth: glyph, maxHeight: glyph }}
        />
      )}
    </div>
  );
}
