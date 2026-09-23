#!/usr/bin/env bash
# The whole check, in one command. This is the CI: it runs on this machine,
# needs no service, and is the same thing the git hooks call.
#
# Add steps as the project grows. Keep it one command, keep it local.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }

step "typecheck"
npx tsc --noEmit

step "tests"
npm test

step "build"
npm run build

step "sizes"
./tools/sizes.sh

printf '\n\033[1;32mall green\033[0m\n'
