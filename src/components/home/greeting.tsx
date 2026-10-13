import {Spark} from "../spark";
import {greetingText, type GreetingInput} from "./greeting-text";

export function HomeGreeting(props: Readonly<GreetingInput>) {
	return (
		<>
			<Spark />
			<h1 className="text-[20px] leading-[25px] font-normal text-primary">{greetingText(props)}</h1>
		</>
	);
}
