import {
	FileJson,
	FileText,
	Brain,
	MessageSquare,
	FolderOpen,
	Star,
	Radio,
	Blocks,
	Settings,
	ListTodo,
	SlidersHorizontal,
} from 'lucide-react';
import type {Section} from './types';

export const navItems = [
	{to: '/active', label: 'Active', icon: Radio, section: 'active' as Section},
	{to: '/starred', label: 'Starred', icon: Star, section: 'starred' as Section},
	{to: '/tasks', label: 'Tasks', icon: ListTodo, section: 'tasks' as Section},
	{to: '/projects', label: 'Projects', icon: FolderOpen, section: 'projects' as Section},
	{to: '/plans', label: 'Plans', icon: FileText, section: 'plans' as Section},
	{to: '/memories', label: 'Memories', icon: Brain, section: 'memories' as Section},
	{to: '/sessions', label: 'Sessions', icon: MessageSquare, section: 'sessions' as Section},
	{to: '/plugins', label: 'Plugins', icon: Blocks, section: 'plugins' as Section},
	{to: '/settings', label: 'Settings', icon: SlidersHorizontal, section: 'settings' as Section},
	{to: '/settings/edit', label: 'Claude Config', icon: FileJson, section: 'config' as Section},
	{to: '/setup', label: 'Setup', icon: Settings, section: 'setup' as Section},
];
