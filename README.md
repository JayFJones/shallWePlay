# shallWePlay

A tic-tac-toe server that AI models play through MCP, the Model Context
Protocol. People can play too, from a browser, at the same tables. The
server is called WOPR.

```
GREETINGS. SHALL WE PLAY A GAME?
```

## How I built this

I built this project with Claude Code, Anthropic's coding agent. Claude Code
wrote most of the code at my direction. I set the goals and made the design
calls. I then reviewed and vetted the code in place. Every decision and its
trade-off is written down in [docs/PLAN.md](docs/PLAN.md), at the time it was
made. The commit history records the reason for each step.

## A salute to WarGames

This project is a homage to *WarGames* (1983, directed by John Badham).

In the film, a teenager named David Lightman dials into WOPR, a military
computer, and asks the program inside it, Joshua, to play Global
Thermonuclear War. The military takes the game for a real attack, and
WOPR controls the real missiles. In the end, David has Joshua play
tic-tac-toe against itself. Every game is a draw. Joshua then plays out
every war it knows, finds no winner, and says:

> A STRANGE GAME. THE ONLY WINNING MOVE IS NOT TO PLAY.

That scene is the idea behind this repo. WOPR had its hands on the real
controls, and nobody could stop it. An MCP server takes the opposite
approach. The model gets a game, and the only controls it has are the tools
the server chooses to expose. The server owns the board and enforces every
rule. A model that tries to move twice, take a used square, or wipe a board
it is losing gets refused.

The film shows up in these details:

- The server calls itself WOPR and greets every client with "SHALL WE PLAY A
  GAME?"
- The pages use a green-on-black terminal screen, like WOPR's in the film.
- The default AI player is named Joshua. My test players were named Falken
  and David.
- After three draws in a row at a table, WOPR says "A STRANGE GAME. THE ONLY
  WINNING MOVE IS NOT TO PLAY." Two Claude players reach that line in about
  a minute.

This is a fan homage. It has no connection to the film or its studio.

## What it shows about MCP

- **Tools, a resource, and a prompt.** Six tools play the game. The
  `wopr://board` resource shows the board. The `shall_we_play` prompt gives
  a model the steps for a whole match, so one slash command in Claude Code
  plays it.
- **Streamable HTTP with sessions.** One server holds every table. Each
  client gets its own MCP session. A seat belongs to the session that took
  it, so one player cannot move for another.
- **Rules enforced in code.** The model sees only the text the tools return,
  and it acts only through them. Every refusal says what went wrong and what
  to do next.
- **Waiting without polling.** A server cannot call a client, so it cannot
  say "your turn". Instead, `wait_for_turn` holds the call open until the
  turn arrives, for up to 55 seconds.
- **The wire, made visible.** The admin panel records every JSON-RPC message
  at the transport, paired with its response. It shows them beside a
  move-by-move replay of each game.

## Run it

You need Node 20 or newer. The server listens on localhost only, port 5171.

```
git clone https://github.com/JayFJones/shallWePlay.git
cd shallWePlay
npm install
npm run dev:up
```

Then open:

- http://localhost:5171 to play.
- http://localhost:5171/admin to watch.

`npm run dev:down` stops the server. `npm run dev:logs` follows its log.

### Play against Claude

Log on at http://localhost:5171. While you wait for an opponent, the page
shows a command with a copy button. Run it in a second terminal:

```
claude -p "/mcp__wopr__shall_we_play Joshua 1" \
  --mcp-config '{"mcpServers":{"wopr":{"type":"http","url":"http://localhost:5171/mcp"}}}' \
  --allowedTools mcp__wopr
```

Claude joins your table, plays one game, and exits. One game costs about
$0.15 in API usage.

### Watch two Claudes play

Run the same command twice, in two terminals, with different names and a
game count:

```
claude -p "/mcp__wopr__shall_we_play Joshua 3" --mcp-config '...' --allowedTools mcp__wopr
claude -p "/mcp__wopr__shall_we_play Falken 3" --mcp-config '...' --allowedTools mcp__wopr
```

Use the same `--mcp-config` value as above. Keep the admin panel open to
watch the games and the MCP calls arrive.

### Use it from a normal Claude Code session

```
claude mcp add --transport http wopr http://localhost:5171/mcp
```

Then, inside Claude Code, type `/mcp__wopr__shall_we_play Joshua 1`.

## The MCP surface

| name | kind | what it does |
| --- | --- | --- |
| `join_game(name)` | tool | Seats you next to a waiting player, or at a new table. |
| `get_board()` | tool | Shows your board and whose turn it is. |
| `wait_for_turn(timeout_seconds?)` | tool | Waits until your turn or the end of the game. |
| `make_move(square)` | tool | Plays square 1 to 9, in reading order. |
| `new_game()` | tool | Starts the next game. The player who moved second goes first. |
| `leave_game()` | tool | Gives up your seat. Leaving mid-game forfeits. |
| `wopr://board` | resource | Your board as text. |
| `shall_we_play(name?, games?)` | prompt | The steps for a whole match. |

The admin panel lists the same surface. It reads the list from the server
itself, the way any MCP client does, so the list cannot drift from the code.

## The admin panel

http://localhost:5171/admin shows four things:

- Every table as it plays.
- The live MCP traffic. Click a call to see its raw request, its raw
  response, and the text the model read.
- The game history, with a move-by-move replay. The replay lists the MCP
  calls behind the game and highlights the call that made each move.
- Every MCP command the server offers, with arguments and an example
  request.

The panel is read-only. It cannot change a game.

## How the code is laid out

| path | holds |
| --- | --- |
| `src/game/` | The rules, one table, and the lobby of tables. No I/O. |
| `src/mcp/` | The `/mcp` endpoint, the tools, and every word the model reads. |
| `src/play.ts` | How a person plays from the browser, over plain HTTP. |
| `src/traffic.ts` | The record of every MCP message. |
| `src/history.ts` | Finished games, in `data/history.jsonl`. |
| `src/admin.ts`, `src/catalog.ts` | The admin panel's data. |
| `public/` | The play page and the admin panel. No build step. |
| `scripts/dev` | Starts, stops and checks the server. |
| `docs/PLAN.md` | Every design decision, why, and what it gives up. |

## Checks

```
npm run check
```

This runs the typecheck, 75 tests, the build, and a line budget on the main
source file. The same command runs before every commit, through a git hook.
Everything runs on your machine. There is no cloud CI.

The tests include real MCP clients playing full games over HTTP against a
real server. They also prove that cheating is refused.

`npm install` turns the hook on, through the `prepare` script.

## Limits

- Localhost only, with no accounts. Anyone on the machine can play or watch.
- `data/history.jsonl` and `data/calls.jsonl` grow until you delete them.
- A person's moves go over plain HTTP, so they are not in the MCP call log.
  In a game between a person and Claude, the replay shows only Claude's
  calls.
- A client that exits without ending its session keeps its seat for up to
  5 minutes.
