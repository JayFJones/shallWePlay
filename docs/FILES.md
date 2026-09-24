# Files

Every file in the repo, what it is for, and what it holds. Paths are from
the repo root. Links open the file.

## Root

| file | purpose and contents |
| --- | --- |
| [README.md](../README.md) | The front page. How the project was built, the WarGames homage, what it shows about MCP, how to run it, and its limits. |
| [TRANSCRIPT.md](../TRANSCRIPT.md) | One recorded game between two Claude players, built from the server's call log. Every MCP call and result, plus one refused cheat. |
| [CLAUDE.md](../CLAUDE.md) | The working agreement Claude Code reads on every turn: writing style, how to report, commit rules, line budgets. |
| [LICENSE](../LICENSE) | MIT license. |
| [package.json](../package.json) | Dependencies, and the `npm run` commands: `build`, `test`, `check`, `start`, and `dev:up`, `dev:down`, `dev:status`, `dev:logs`, `dev:restart`. `prepare` turns on the git hook at install. |
| [package-lock.json](../package-lock.json) | Exact dependency versions, written by npm. |
| [tsconfig.json](../tsconfig.json) | TypeScript settings. Strict mode, ES modules, `src/` compiles to `dist/`. |
| [.gitignore](../.gitignore) | Keeps build output, runtime data, and private notes out of git. |

## docs/

| file | purpose and contents |
| --- | --- |
| [PLAN.md](PLAN.md) | The living plan. How the server works, the MCP surface, the build order, the done checklist, and every design decision with its reason and what it gives up. |
| [FILES.md](FILES.md) | This listing. |

## src/game/: the game, with no network code

| file | purpose and contents |
| --- | --- |
| [rules.ts](../src/game/rules.ts) | Tic-tac-toe rules as pure functions. Legal moves, the eight win lines, draws, and why a move is refused. |
| [table.ts](../src/game/table.ts) | One table. Seats, turn order, forfeits, the draw streak, waiting for a turn, and a record of each finished game. |
| [lobby.ts](../src/game/lobby.ts) | All tables. Seats a new player next to a waiting one, or opens a new table. Closes empty tables. |
| [types.ts](../src/game/types.ts) | Shapes other files share: the table view, the finished-game record, and the error names. |
| [rules.test.ts](../src/game/rules.test.ts) | Tests every win line, draws, and each kind of refused move. |
| [table.test.ts](../src/game/table.test.ts) | Tests seats, turns, forfeits, new games, waiting, and game records. |
| [lobby.test.ts](../src/game/lobby.test.ts) | Tests table assignment, table closing, and finished-game reports across tables. |

## src/mcp/: the MCP server

| file | purpose and contents |
| --- | --- |
| [endpoint.ts](../src/mcp/endpoint.ts) | The `/mcp` endpoint over Streamable HTTP. One session per client, each with its own transport and server. |
| [server.ts](../src/mcp/server.ts) | The six tools, the `wopr://board` resource, and the `shall_we_play` prompt. Ties each seat to its MCP session. |
| [text.ts](../src/mcp/text.ts) | Every word a model reads: the board drawing, status lines, refusal messages, server instructions, and the match steps. |

## src/: the rest of the server

| file | purpose and contents |
| --- | --- |
| [main.ts](../src/main.ts) | Starts the server on port 5171, with history and call log in `data/`. |
| [http.ts](../src/http.ts) | Builds the shared parts and mounts the three ways in: `/mcp`, the play page, and the admin panel. |
| [sessions.ts](../src/sessions.ts) | Live MCP sessions. Frees a seat after 5 quiet minutes and drops a session after an hour. |
| [play.ts](../src/play.ts) | How a person plays: plain HTTP routes and a live stream for the play page. Frees a seat when the page closes. |
| [history.ts](../src/history.ts) | Finished games, kept in memory and appended to `data/history.jsonl`. |
| [traffic.ts](../src/traffic.ts) | Records every MCP message at the transport, paired with its response, and tags it with player and game. Appends to `data/calls.jsonl`. |
| [catalog.ts](../src/catalog.ts) | Builds the list of MCP commands by asking a copy of the server in memory. |
| [admin.ts](../src/admin.ts) | The admin panel's JSON routes and live stream. Read-only. |
| [http.test.ts](../src/http.test.ts) | Real MCP clients play over HTTP. Covers cheating, sessions, the call log, the command list, and the admin routes. |
| [play.test.ts](../src/play.test.ts) | A person over HTTP plays an MCP client. Covers tokens, the page stream, and freeing a closed page's seat. |
| [sessions.test.ts](../src/sessions.test.ts) | Tests the idle rules with a fake clock. |
| [history.test.ts](../src/history.test.ts) | Tests writing, reloading, and skipping a damaged line. |

## public/: the web pages, served as-is with no build step

| file | purpose and contents |
| --- | --- |
| [index.html](../public/index.html) | The play page: the WarGames greeting, LOGON, the board, and the command to bring Claude to the table. |
| [play.js](../public/play.js) | The play page's script. Joins, moves, copy buttons, and the live board. |
| [admin.html](../public/admin.html) | The admin panel's layout and styles. |
| [admin.js](../public/admin.js) | The admin panel's script. Live tables, MCP traffic, history with replay, and the command list. |

## scripts/, tools/ and .githooks/

| file | purpose and contents |
| --- | --- |
| [scripts/dev](../scripts/dev) | Runs the server in the background: `up`, `down`, `status`, `logs`, `restart`. |
| [tools/check.sh](../tools/check.sh) | The one local check: typecheck, tests, build, and line budgets. |
| [tools/sizes.sh](../tools/sizes.sh) | Line budgets for the main files, with the reason each time one was raised. |
| [.githooks/pre-commit](../.githooks/pre-commit) | Runs `tools/check.sh` before every commit. |

## Made at run time, not in git

| path | purpose and contents |
| --- | --- |
| `dist/` | The compiled JavaScript, from `npm run build`. |
| `data/history.jsonl` | One line per finished game. |
| `data/calls.jsonl` | One line per MCP message. |
| `.dev/wopr.pid`, `.dev/wopr.log` | The running server's process id and log, from `scripts/dev`. |
