import {describe, it, expect} from 'vitest';
import {detectLanguage} from '../src/lib/diff-utils';

describe('detectLanguage', () => {
	it('detects TypeScript from .ts extension', () => {
		expect(detectLanguage('/src/index.ts')).toBe('typescript');
	});

	it('detects TypeScript JSX from .tsx extension', () => {
		expect(detectLanguage('/components/app.tsx')).toBe('tsx');
	});

	it('detects JavaScript from .js extension', () => {
		expect(detectLanguage('/lib/utils.js')).toBe('javascript');
	});

	it('detects Python from .py extension', () => {
		expect(detectLanguage('/scripts/run.py')).toBe('python');
	});

	it('detects JSON from .json extension', () => {
		expect(detectLanguage('/package.json')).toBe('json');
	});

	it('detects CSS from .css extension', () => {
		expect(detectLanguage('/styles/main.css')).toBe('css');
	});

	it('detects HTML from .html extension', () => {
		expect(detectLanguage('/index.html')).toBe('html');
	});

	it('detects Markdown from .md extension', () => {
		expect(detectLanguage('/README.md')).toBe('markdown');
	});

	it('detects YAML from .yml extension', () => {
		expect(detectLanguage('/config.yml')).toBe('yaml');
	});

	it('detects YAML from .yaml extension', () => {
		expect(detectLanguage('/config.yaml')).toBe('yaml');
	});

	it('detects shell from .sh extension', () => {
		expect(detectLanguage('/run.sh')).toBe('shellscript');
	});

	it('detects Rust from .rs extension', () => {
		expect(detectLanguage('/src/main.rs')).toBe('rust');
	});

	it('detects Go from .go extension', () => {
		expect(detectLanguage('/main.go')).toBe('go');
	});

	it('detects Ruby from .rb extension', () => {
		expect(detectLanguage('/app.rb')).toBe('ruby');
	});

	it('detects Java from .java extension', () => {
		expect(detectLanguage('/Main.java')).toBe('java');
	});

	it('returns null for unknown extensions', () => {
		expect(detectLanguage('/data.xyz')).toBeNull();
	});

	it('returns null for files without extensions', () => {
		expect(detectLanguage('/Makefile')).toBeNull();
	});

	it('handles deeply nested paths', () => {
		expect(detectLanguage('/a/b/c/d/file.tsx')).toBe('tsx');
	});

	it('detects SQL from .sql extension', () => {
		expect(detectLanguage('/migrations/001.sql')).toBe('sql');
	});

	it('detects TOML from .toml extension', () => {
		expect(detectLanguage('/Cargo.toml')).toBe('toml');
	});

	it('detects JSX from .jsx extension', () => {
		expect(detectLanguage('/component.jsx')).toBe('jsx');
	});
});
