type HerdrStatusPresentation = {
  colorClassName: string;
  label: string;
};

function statusPresentation(status: string): HerdrStatusPresentation {
  switch (status) {
    case "blocked":
      return { colorClassName: "bg-red-500", label: "blocked" };
    case "working":
      return { colorClassName: "bg-yellow-500", label: "working" };
    case "done":
      return { colorClassName: "bg-blue-500", label: "done" };
    case "idle":
      return { colorClassName: "bg-green-500", label: "idle" };
    default:
      return { colorClassName: "bg-gray-500", label: "unknown" };
  }
}

export function HerdrStatusIndicator({ status }: { status: string }) {
  const presentation = statusPresentation(status);

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-text-500"
      aria-label={`Herdr agent status: ${presentation.label}`}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${presentation.colorClassName}`}
        aria-hidden="true"
      />
      <span>{presentation.label}</span>
    </span>
  );
}
