# Plan: shallWePlay

A tic-tac-toe game that AI players and people play through MCP. The server
is WOPR, the computer from WarGames (1983). It opens with "SHALL WE PLAY A
GAME?"

This file records design decisions. Each entry says what we chose, why,
and what it gives up. Add an entry when a decision is made, not after.

## What it proves

A model can play a game with rules it cannot break. The server owns the
board and the rules. The model only sees what the tools tell it, and it
can only act through them. That is the same shape as giving a model a
bounded view into any real system.

## How it works

One Node process listens on port 5171. It does three jobs:

1. Holds the one game table: the board, whose turn it is, who sits where.
2. Speaks MCP over HTTP at `/mcp`. AI players connect here.
3. Serves a static page at `/`. It shows the board live, and a person can
   click to take a seat and play.

```
Claude Code (X) ──MCP──┐
                       ├── WOPR on :5171 ── one table
Claude Code (O) ──MCP──┤
Browser (watch/play) ──┘   (plain HTTP + live updates)
```

## MCP surface

### Tools

| tool | what it does |
| --- | --- |
| `join_game(name)` | takes a free seat and returns X or O. Refuses if both seats are taken. |
| `get_board()` | returns the board, whose turn it is, and the result if the game is over. |
| `make_move(square)` | plays square 1 to 9. Refuses if it is not your turn, the square is taken, or the game is over. |
| `wait_for_turn(timeout_seconds)` | waits until it is your turn or the game ends. Returns early with "still waiting" after the timeout, so the model can call it again. |
| `new_game()` | clears the board for the same two players. X and O swap who goes first. |
| `leave_game()` | gives up your seat. |

The seat belongs to the MCP session. One player cannot move for the other.

### Resource

`wopr://board`, the board as text. A client can read it without a tool call.

### Prompt

`shall_we_play`, the instructions for playing a whole game: join, wait,
move, repeat until it ends. In Claude Code it shows up as the slash command
`/mcp__wopr__shall_we_play`.

### The WarGames touches

- The page is a green-on-black terminal screen.
- The first message is "GREETINGS. SHALL WE PLAY A GAME?"
- After three draws in a row, WOPR says "A STRANGE GAME. THE ONLY WINNING
  MOVE IS NOT TO PLAY."

## Files

| file | holds |
| --- | --- |
| `src/game/rules.ts` | pure rules: legal moves, win lines, draw. No I/O. |
| `src/game/table.ts` | the one table: seats, turn, waiters, draw count. |
| `src/mcp/server.ts` | the tools, resource, and prompt. |
| `src/http.ts` | the HTTP server: `/mcp`, the page, live updates. |
| `public/index.html` | the static page. |
| `scripts/dev` | `up`, `down`, `status`, `logs`, `restart`, using `.dev/`. |

## Build order

Each step leaves something that works, and gets its own commit.

1. `git init`, `.gitignore`, npm, TypeScript. `npm run build` passes.
   Wire `tools/check.sh` and the pre-commit hook.
2. `rules.ts` with tests. Every win line, draw, bad square, wrong turn.
3. `table.ts` with tests. Seats, turn order, `wait_for_turn` waking up.
4. The MCP server over HTTP with `join_game`, `get_board`, `make_move`.
   Connect one Claude Code window and play a few moves.
5. Add `wait_for_turn`, `new_game`, `leave_game`, the resource, and the
   prompt. Play a full game between two Claude Code windows.
6. The static page and `scripts/dev`. A person plays one AI.
7. `TRANSCRIPT.md`: one full AI against AI game from both windows, with the
   tool calls, and one cheat attempt refused.
8. `README.md`, drafted in Jay's voice for Jay to edit.

## Done means

- [ ] `git clone`, `npm install`, `npm run dev:up`, and the page loads on
      http://localhost:5171.
- [ ] Two Claude Code windows play a full game with no help.
- [ ] A person in the browser plays one AI.
- [ ] The server refuses a cheat move, and the transcript shows it.
- [ ] `tools/check.sh` passes.
- [ ] Jay has read the README and it sounds like him.

## Decisions

### Dropped foundryProbe, built a game instead (2026-09-23)

Why: a game has rules anyone can check at a glance. A reader needs no
foundry knowledge to see the model follow them.

Gives up: the direct match to a job posting that asked for MCP over
manufacturing data.

### One HTTP server holds the table (2026-09-23)

Why: a stdio server is private to the client that starts it. Two AIs on
stdio would play on two different boards. One HTTP server gives one board.

Gives up: stdio's zero setup. The server must be running before a client
connects, so the project needs `scripts/dev`.

### Players are two Claude Code windows (2026-09-23)

Why: it costs nothing beyond the existing plan, and you can watch each side
think.

Gives up: a hands-off match. A person starts each side. A script that
drives two models through the API could come later.

### Repo name: shallWePlay, public (2026-09-23)

Why: the movie line, in the camelCase of the other repos. A public repo
opens without an account.

Gives up: the name does not say "tic-tac-toe". The README does.

### wait_for_turn blocks, with a timeout (2026-09-23)

MCP clients call servers. A server cannot tap a client and say "your turn".
So `wait_for_turn` holds the call open until the turn comes, up to 30
seconds, then returns "still waiting".

Why: the model makes one call per wait, not dozens of `get_board` polls.
The timeout stays under client tool limits.

Gives up: a long wait costs the model a few extra calls.

### A losing player cannot erase the loss (2026-09-23)

Leaving mid-game forfeits the game to the other player. `new_game` is
refused while a game is in progress. A player who joins after a finished
game gets a fresh board.

Why: an AI that is losing may try to leave or reset. Both moves now lose
or get refused, and the tests prove it.

Gives up: a player who drops by accident loses the game.

### Defaults taken without a question (2026-09-23)

- Express for HTTP. The MCP SDK examples use it.
- The page gets live updates through server-sent events. That is a one-way
  stream from the server, with no extra library.
- `node:test` for tests, so `tools/check.sh` can run `npm test` with no
  new dependency.
- One table only. No lobby, no accounts, no saved games.
- `DEMO_BRIEF.md`, `WORKING-NOTES.md` and `SETUP.md` stay out of git. The
  brief names past employers.
