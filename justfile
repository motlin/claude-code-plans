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
    just ensure-sqlite-native

# Verify better-sqlite3 native modules match the active Node runtime
[group('setup')]
ensure-sqlite-native:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -d node_modules/.pnpm ]; then
        exit 0
    fi
    find node_modules/.pnpm -path "*/node_modules/better-sqlite3/package.json" -print | sort | while IFS= read -r package_json; do
        package_dir="$PWD/$(dirname "$package_json")"
        if node -e 'const Database = require(process.argv[1]); new Database(":memory:").close();' "$package_dir" >/dev/null 2>&1; then
            continue
        fi
        rm -rf "$package_dir/build"
        pnpm --dir "$package_dir" run build-release
        node -e 'const Database = require(process.argv[1]); new Database(":memory:").close();' "$package_dir"
    done

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

# Regenerate documentation screenshots
[group('docs')]
screenshots *args: install
    vp exec tsx scripts/screenshots.ts {{args}}

# Build static Storybook site
build-storybook: install
    vp run build-storybook

# Apply safe Fallow fixes locally, then reject remaining dead code
fallow: install
    {{ if ci == "" { "vp run fallow" } else { "true" } }}
    vp run fallow:ci

# vp run fallow:ci
fallow-check: install
    vp run fallow:ci

# Run pre-commit hooks on all files (same as CI's pre-commit job)
pre-commit: install
    pre-commit run --all-files

# Run all pre-commit checks
[arg("quick", long, value="true", help="Skip tests")]
verify quick="": check build fallow pre-commit
    {{ if quick != "true" { "just test" } else { "true" } }}
    @echo "All pre-commit checks passed!"

# Deprecated alias for `verify`
[arg("quick", long, value="true", help="Skip tests")]
precommit quick="": (verify quick)
