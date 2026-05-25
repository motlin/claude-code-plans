# `just --list --unsorted`
[group('default')]
default:
    @just --list --unsorted

ci := env("CI", "")
port := "7526"

# Install dependencies
[group('setup')]
install:
    pnpm exec vp install

# Run dev server with Vite (wrapped by Spotlight sidecar)
dev *args: install
    PORT={{port}} pnpm dlx @spotlightjs/spotlight run pnpm exec vp dev {{args}}

# Run production server
start *args: install build
    PORT={{port}} pnpm run start {{args}}

# Run linter
lint: install
    pnpm exec vp lint {{ if ci != "" { "--format github" } else { "--fix" } }}

# Run formatter
format: install
    pnpm exec vp fmt {{ if ci != "" { "--check" } else { "" } }}

# Run checks (format + lint + typecheck)
check: install
    pnpm exec vp check {{ if ci != "" { "" } else { "--fix" } }}

# Run tests
test *args: install
    {{ if ci != "" { "pnpm exec vp exec playwright install --with-deps chromium" } else { "true" } }}
    pnpm exec vp run test:run {{args}}

# Type-check the project (build first to generate routeTree.gen.ts)
typecheck: install build
    pnpm exec vp run typecheck

# Build the project
build: install
    pnpm exec vp run build

# Run Storybook dev server
storybook *args: install
    pnpm exec vp run storybook {{args}}

# Build static Storybook site
build-storybook: install
    pnpm exec vp run build-storybook

# Run fallow codebase intelligence (dead code, duplication, drift)
fallow: build
    pnpm exec vp run {{ if ci != "" { "fallow:ci" } else { "fallow" } }}

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": check build fallow
    {{ if quick != "true" { "just test" } else { "true" } }}
    @echo "All pre-commit checks passed!"
