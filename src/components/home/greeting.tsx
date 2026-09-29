export interface GreetingInput {
  name: string | undefined;
  /** True when the action center has nothing that needs attention. */
  clear: boolean;
}

/** Upstream's four home greetings; there are no time-of-day variants. */
export function greetingText({ name, clear }: GreetingInput): string {
  const trimmed = name?.trim();
  if (clear) return trimmed ? `What’s up next, ${trimmed}?` : "What’s up next?";
  return trimmed ? `Welcome back, ${trimmed}` : "Welcome back";
}

const SPARK_RAYS = 12;

const SPARK_POINTS = Array.from({ length: SPARK_RAYS * 2 }, (_, i) => {
  const angle = (Math.PI * i) / SPARK_RAYS - Math.PI / 2;
  const radius = i % 2 === 0 ? 48 : 14;
  return `${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`;
}).join(" ");

function Spark({ size = 22 }: Readonly<{ size?: number }>) {
  return (
    <svg
      data-cds="Spark"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="var(--color-clay, #d97757)"
      aria-hidden="true"
      className="shrink-0"
    >
      <polygon points={SPARK_POINTS} strokeLinejoin="round" />
    </svg>
  );
}

export function HomeGreeting(props: Readonly<GreetingInput>) {
  return (
    <>
      <Spark />
      <h1 className="text-[20px] leading-[25px] font-normal text-primary">{greetingText(props)}</h1>
    </>
  );
}
