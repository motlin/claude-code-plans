const SPARK_RAYS = 12;

const SPARK_POINTS = Array.from({ length: SPARK_RAYS * 2 }, (_, i) => {
  const angle = (Math.PI * i) / SPARK_RAYS - Math.PI / 2;
  const radius = i % 2 === 0 ? 48 : 14;
  return `${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`;
}).join(" ");

/** Upstream claude.ai/code's Claude spark; `animated` sets `data-animated` for the thinking spin. */
export function Spark({ size = 22, animated }: Readonly<{ size?: number; animated?: boolean }>) {
  return (
    <svg
      data-cds="Spark"
      {...(animated === undefined ? {} : { "data-animated": String(animated) })}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="var(--color-clay, #d97757)"
      aria-hidden="true"
      className="spark shrink-0"
    >
      <polygon points={SPARK_POINTS} strokeLinejoin="round" />
    </svg>
  );
}
