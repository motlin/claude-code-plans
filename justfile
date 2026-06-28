# `just --list --unsorted`
[group('default')]
default:
    @just --list --unsorted

ci := env("CI", "")
port := "7526"

# Install dependencies
[group('setup')]
install:
    vp install

# Run dev server with Vite
dev *args: install
    PORT={{port}} vp dev {{args}}

# Run production server
start *args: install build
    PORT={{port}} vp run start {{args}}

# Run linter
lint: install
    vp lint {{ if ci != "" { "--format github" } else { "--fix" } }}

# Run formatter
format: install
    vp fmt {{ if ci != "" { "--check" } else { "" } }}

# Run checks (format + lint + typecheck)
check: install
    vp check {{ if ci != "" { "" } else { "--fix" } }}

# Run tests
test *args: install
    {{ if ci != "" { "if test -x node_modules/.bin/playwright; then vp exec playwright install --with-deps chromium; fi" } else { "true" } }}
    vp run test:run {{args}}

# Type-check the project (build first to generate routeTree.gen.ts)
typecheck: install build
    vp run typecheck

# Build the project
build: install
    vp run build

# Run Storybook dev server
storybook *args: install
    vp run storybook {{args}}

# Build static Storybook site
build-storybook: install
    vp run build-storybook

# Run fallow codebase intelligence (dead code, duplication, drift)
fallow: install
    vp run {{ if ci != "" { "fallow:ci" } else { "fallow" } }}

# vp run fallow:ci
fallow-check: install
    vp run fallow:ci

# Run pre-commit hooks on all files (same as CI's pre-commit job)
pre-commit: install
    pre-commit run --all-files

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": check build fallow-check pre-commit
    {{ if quick != "true" { "just test" } else { "true" } }}
    @echo "All pre-commit checks passed!"
