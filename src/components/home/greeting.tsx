import { Spark } from "../spark";

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

export function HomeGreeting(props: Readonly<GreetingInput>) {
  return (
    <>
      <Spark />
      <h1 className="text-[20px] leading-[25px] font-normal text-primary">{greetingText(props)}</h1>
    </>
  );
}
