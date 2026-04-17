import {Bug} from 'lucide-react';
import {useDebug} from './debug-provider';

export function DebugToggle() {
	const {enabled, toggle} = useDebug();

	return (
		<button
			type="button"
			onClick={toggle}
			title={enabled ? 'Debug mode on (click to disable)' : 'Debug mode off (click to enable)'}
			className={`flex items-center justify-center rounded-md p-1.5 transition-all border border-border-300/15 ${
				enabled ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-500 hover:text-text-100 hover:bg-bg-200/50'
			}`}
		>
			<Bug className="h-4 w-4" />
		</button>
	);
}
