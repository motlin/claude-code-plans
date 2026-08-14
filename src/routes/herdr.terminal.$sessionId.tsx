import { createFileRoute, Link } from "@tanstack/react-router";
import { HerdrTerminal } from "../components/herdr-terminal";
import { SessionTranscriptLink } from "../components/session-terminal-links";

export const Route = createFileRoute("/herdr/terminal/$sessionId")({
  component: HerdrTerminalPage,
  head: () => ({ meta: [{ title: "Live Herdr terminal" }] }),
});

function HerdrTerminalPage() {
  const { sessionId } = Route.useParams();
  return (
    <div>
      <div className="flex items-center gap-3">
        <Link to="/herdr" className="text-sm text-t6 hover:text-primary">
          Herdr
        </Link>
        <span className="text-t6">/</span>
        <h1 className="text-lg font-semibold">Live terminal</h1>
        <SessionTranscriptLink sessionId={sessionId} />
      </div>
      <HerdrTerminal sessionId={sessionId} />
    </div>
  );
}
