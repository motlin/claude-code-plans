import {USER_CODE_CLASS} from "./user-code-classes";

/** Upstream `U`'s fallback: the plain code chip, isolated left-to-right. */
export function PlainUserCode({text}: {text: string})
{
	return (
		<bdi dir="ltr">
			<code className={USER_CODE_CLASS}>{text}</code>
		</bdi>
	);
}
