// The page a person plays on. It talks plain HTTP to /api/play and listens
// to /api/play/events for its own board. Names come from other players, so
// text only ever goes in through textContent.

const $ = (id) => document.getElementById(id);
const LINES = [[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]];

// A random token per browser, kept so a reload keeps the seat. Storage can
// be blocked, in which case the token lasts as long as the tab.
function playerToken() {
  const make = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
  try {
    const kept = localStorage.getItem('wopr-player');
    if (kept) return kept;
    const token = make();
    localStorage.setItem('wopr-player', token);
    return token;
  } catch {
    return make();
  }
}
const token = playerToken();

// What each refusal means to a person. The MCP players get their own
// wording from the server, which names tools a person never sees.
const REFUSALS = {
  bad_square: 'THAT IS NOT A SQUARE.',
  square_taken: 'THAT SQUARE IS TAKEN.',
  not_your_turn: 'NOT YOUR TURN. WAIT FOR YOUR OPPONENT.',
  game_over: 'THE GAME IS OVER. START A NEW GAME.',
  table_full: 'THAT TABLE IS FULL.',
  not_seated: 'YOU ARE NOT AT A TABLE. LOG ON AGAIN.',
  no_opponent: 'WAIT FOR AN OPPONENT TO JOIN.',
  game_in_progress: 'FINISH THIS GAME FIRST.',
  bad_token: 'THIS BROWSER COULD NOT IDENTIFY ITSELF. RELOAD THE PAGE.',
};

let view = null;
let message = '';

async function post(path, body = {}) {
  const res = await fetch(`/api/play/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wopr-player': token },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  message = result.ok ? '' : REFUSALS[result.error] ?? `REFUSED: ${result.error}`;
  if ('view' in result) view = result.view;
  render();
  return result;
}

// ---- the opening -------------------------------------------------------

function typeOut(lines, done) {
  const screen = $('screen');
  const text = lines.join('\n');
  let i = 0;
  const tick = () => {
    screen.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(tick, text[i - 1] === '\n' ? 220 : 28);
    else done?.();
  };
  tick();
}

function showLogon() {
  $('game').hidden = true;
  $('logon').hidden = false;
  $('name').focus();
}

$('logon').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  if (!name) return;
  $('logon').hidden = true;
  $('screen').textContent = `LOGON: ${name}\n\nGREETINGS, ${name.toUpperCase()}. SHALL WE PLAY A GAME?`;
  const result = await post('join', { name });
  if (!result.ok) {
    $('screen').textContent += `\n\n${message}`;
    showLogon();
  }
});

// ---- the game ----------------------------------------------------------

function statusLine(v) {
  const name = (mark) => v.players[mark] ?? 'NOBODY';
  const o = v.outcome;
  if (o?.kind === 'win') return o.winner === v.you ? 'YOU WIN.' : `${name(o.winner).toUpperCase()} WINS.`;
  if (o?.kind === 'draw') return 'A DRAW.';
  if (o?.kind === 'forfeit') return o.winner === v.you ? 'YOU WIN. YOUR OPPONENT LEFT.' : 'YOU FORFEITED.';
  if (!v.players.X || !v.players.O) return 'WAITING FOR AN OPPONENT...';
  return v.toMove === v.you ? 'YOUR MOVE.' : `${name(v.toMove).toUpperCase()} IS THINKING...`;
}

function winLine(v) {
  if (v.outcome?.kind === 'win') return v.outcome.line;
  return LINES.find(([a, b, c]) => v.board[a - 1] && v.board[a - 1] === v.board[b - 1] && v.board[a - 1] === v.board[c - 1]) ?? [];
}

function render() {
  if (!view) return;
  $('logon').hidden = true;
  $('game').hidden = false;

  const v = view;
  const opponent = v.you === 'X' ? 'O' : 'X';
  const myTurn = !v.outcome && v.players[opponent] && v.toMove === v.you;
  const line = winLine(v);
  $('board').replaceChildren(...v.board.map((cell, i) => {
    const square = i + 1;
    const playable = myTurn && !cell;
    const b = document.createElement('button');
    b.className = [cell ? '' : 'open', playable ? 'playable' : '', line.includes(square) ? 'win' : ''].join(' ').trim();
    b.textContent = cell ?? square;
    b.setAttribute('aria-label', cell ? `square ${square}, ${cell}` : `square ${square}, open`);
    b.disabled = !playable;
    b.addEventListener('click', () => post('move', { square }));
    return b;
  }));

  $('who').textContent = `TABLE ${v.table}. YOU ARE ${v.you} (${v.players[v.you] ?? ''}). ${opponent}: ${v.players[opponent] ?? 'NOBODY YET'}.`;
  $('status').textContent = statusLine(v);
  $('message').textContent = message;
  $('strange').hidden = !v.strangeGame;
  $('again').hidden = !v.outcome || !v.players[opponent];
  $('summon').hidden = Boolean(v.players[opponent]);
  $('summon-add').textContent = `claude mcp add --transport http wopr ${location.origin}/mcp`;
}

$('again').addEventListener('click', () => post('new'));
$('leave').addEventListener('click', async () => {
  await post('leave');
  view = null;
  message = '';
  $('screen').textContent = 'GOODBYE.\n\nLOGON:';
  showLogon();
});

// ---- the live board ----------------------------------------------------

// The stream is also how the server knows this page is still open. Close
// the tab and the seat is freed after a minute.
function listen() {
  const events = new EventSource(`/api/play/events?player=${encodeURIComponent(token)}`);
  let first = true;
  events.addEventListener('view', (e) => {
    const next = JSON.parse(e.data);
    if (first) {
      first = false;
      // A reload while seated goes straight back to the board.
      if (next) { view = next; $('screen').textContent = 'WELCOME BACK. SHALL WE CONTINUE?'; render(); return; }
      typeOut(['GREETINGS.', '', 'SHALL WE PLAY A GAME?', '', 'TIC-TAC-TOE AGAINST A PERSON OR AN AI.', 'ENTER YOUR NAME TO BEGIN.'], showLogon);
      return;
    }
    if (next) {
      view = next;
      message = '';
      render();
    } else if (view) {
      // The seat went away without this page asking: the server restarted,
      // or the page was closed long enough to lose it.
      view = null;
      $('screen').textContent = 'CONNECTION TERMINATED.\n\nLOGON:';
      showLogon();
    }
  });
}

listen();
