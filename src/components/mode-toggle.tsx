import {Moon, Sun, Monitor} from 'lucide-react';
import {useTheme} from './theme-provider';

export function ModeToggle() {
	const {theme, setTheme} = useTheme();

	return (
		<div className="flex gap-0.5 rounded-lg border border-border-300/15 bg-bg-000/80 p-0.5 backdrop-blur-sm">
			<ToggleButton
				active={theme === 'light'}
				onClick={() => setTheme('light')}
				title="Light"
			>
				<Sun className="h-4 w-4" />
			</ToggleButton>
			<ToggleButton
				active={theme === 'system'}
				onClick={() => setTheme('system')}
				title="System"
			>
				<Monitor className="h-4 w-4" />
			</ToggleButton>
			<ToggleButton
				active={theme === 'dark'}
				onClick={() => setTheme('dark')}
				title="Dark"
			>
				<Moon className="h-4 w-4" />
			</ToggleButton>
		</div>
	);
}

function ToggleButton({
	active,
	onClick,
	title,
	children,
}: {
	active: boolean;
	onClick: () => void;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={`flex items-center justify-center rounded-md p-1.5 transition-all ${
				active ? 'bg-bg-000 text-text-100 shadow-sm' : 'text-text-500 hover:text-text-100 hover:bg-bg-200/50'
			}`}
		>
			{children}
		</button>
	);
}
