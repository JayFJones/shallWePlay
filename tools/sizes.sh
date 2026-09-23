#!/usr/bin/env bash
# A budget, in lines, for the files that run away.
#
# The number next to a file is what it is allowed to be TODAY. When a file
# is split, lower its number in the same commit. A budget that only ever
# rises is a budget nobody is keeping.
set -euo pipefail
cd "$(dirname "$0")/.."

# file                             budget
BUDGETS="
src/game/rules.ts                  90
# table.ts: raised from 200 when it began recording finished games for
# the history, then lowered from 250 when its shared types moved to
# types.ts. The record reads the private move list and clock, so it
# belongs with them.
src/game/table.ts                  230
src/game/types.ts                  60
src/game/lobby.ts                  100
# text.ts: raised from 80 when the greeting and the shall_we_play steps
# moved in. It holds every word the model reads, on purpose, in one place.
src/mcp/text.ts                    110
# server.ts: raised from 150 for six tools, a resource and a prompt. It is
# a flat list of registrations and holds no state, so it grows only when
# the MCP surface does.
src/mcp/server.ts                  190
src/http.ts                        90
src/mcp/endpoint.ts                90
src/sessions.ts                    100
src/history.ts                     80
src/admin.ts                       100
src/traffic.ts                     180
src/catalog.ts                     80
public/admin.js                    420
"

fat=0
while read -r file budget; do
  [ -z "$file" ] && continue
  [ -f "$file" ] || continue
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$budget" ]; then
    printf '  %s is %s lines, over its budget of %s\n' "$file" "$lines" "$budget"
    fat=1
  else
    printf '  %s %s/%s\n' "$file" "$lines" "$budget"
  fi
done <<< "$BUDGETS"

if [ "$fat" -ne 0 ]; then
  cat <<'WHY'

A file is over budget. Two honest ways out:

  1. Move something into its own module, and LOWER the budget here in the
     same commit.
  2. Decide the file has earned the room, and raise the number here with a
     line saying why.

Either is fine. Doing neither, quietly, is what the budget exists to stop.
WHY
  exit 1
fi
