import {ThemeProvider} from '../../components/theme-provider';
import type {Decorator} from '@storybook/react-vite';

export const withTheme: Decorator = (Story) => (
	<ThemeProvider defaultTheme="light">
		<Story />
	</ThemeProvider>
);

export const withDarkTheme: Decorator = (Story) => (
	<ThemeProvider defaultTheme="dark">
		<Story />
	</ThemeProvider>
);
