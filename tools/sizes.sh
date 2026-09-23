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
src/game/table.ts                  200
src/mcp/text.ts                    80
src/mcp/server.ts                  150
src/http.ts                        120
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
