import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import type { ToolRendererProps } from "./types";
import { KeyValueCard } from "./shared";
import { MarkdownArticle } from "../markdown-article";
import { toMdSlug } from "../../lib/md-slug";
import {
  describeExitPlanModeResult,
  parseAllowedPrompts,
  type ExitPlanModeStatusTone,
} from "../../lib/exit-plan-mode";

const PLAN_FILE_RE = /\.claude\/plans\/([^/\s]+\.md)/;

const TONE_CLASS: Record<ExitPlanModeStatusTone, string> = {
  approved: "text-success-000",
  rejected: "text-danger-000",
  error: "text-danger-000",
  info: "text-assistant-secondary",
};

export function ExitPlanModeRenderer({ toolCall }: ToolRendererProps) {
  const { result } = toolCall;
  const planFilePath = (toolCall.input["planFilePath"] as string) ?? "";
  const planMatch = planFilePath.match(PLAN_FILE_RE) ?? result?.match(PLAN_FILE_RE);
  const plan = typeof toolCall.input["plan"] === "string" ? toolCall.input["plan"] : "";
  const allowedPrompts = parseAllowedPrompts(toolCall.input["allowedPrompts"]);
  const status = describeExitPlanModeResult(result, toolCall.isError);

  return (
    <KeyValueCard isError={toolCall.isError} params={[]} copyText={plan || result || ""}>
      {planMatch && (
        <Link
          to="/plan/$filename"
          params={{ filename: toMdSlug(planMatch[1]!) }}
          className="inline-flex items-center gap-1 text-body text-accent-100 hover:underline"
        >
          <FileText size={12} />
          Plan created
        </Link>
      )}
      {plan && <MarkdownArticle markdown={plan} />}
      {allowedPrompts.length > 0 && (
        <div className="flex flex-col text-body text-assistant-secondary">
          {allowedPrompts.map((allowed, index) => (
            <div key={`${allowed.tool}-${index}`} data-allowed-prompt>
              <span className="text-assistant-primary">{allowed.tool}</span> — {allowed.prompt}
            </div>
          ))}
        </div>
      )}
      {status && (
        <div className={TONE_CLASS[status.tone]}>
          <div>{status.text}</div>
          {status.detail && <div className="text-assistant-secondary">{status.detail}</div>}
        </div>
      )}
    </KeyValueCard>
  );
}
