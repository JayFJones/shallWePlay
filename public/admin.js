// The WOPR admin panel. Every name and every MCP message on this page comes
// from a player, so text goes in through textContent and never innerHTML.

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) if (child != null) node.append(child);
  return node;
};

const LINES = [[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]];
const TRAFFIC_SHOWN = 60;

let state = { tables: [], history: [] };
let traffic = [];
let hideWaits = false;
let openCall = null;
let selected = null;
let step = 0;
let gameCalls = [];

// ---- boards and results ------------------------------------------------

function drawBoard(cells, { winLine = [], last = null } = {}) {
  return el('div', { className: 'board' }, cells.map((cell, i) => {
    const square = i + 1;
    const classes = [cell ? '' : 'open', winLine.includes(square) ? 'win' : '', last === square ? 'last' : ''];
    return el('div', { className: classes.join(' ').trim(), textContent: cell ?? square });
  }));
}

function resultText(outcome, players) {
  if (!outcome) return null;
  const who = (mark) => `${mark} (${players[mark] ?? 'gone'})`;
  if (outcome.kind === 'win') return `${who(outcome.winner)} WINS`;
  if (outcome.kind === 'forfeit') return `${who(outcome.winner)} WINS BY FORFEIT`;
  return 'DRAW';
}

function tableStatus(view) {
  const result = resultText(view.outcome, view.players);
  if (result) return { text: `GAME OVER. ${result}.`, over: true };
  if (!view.players.X || !view.players.O) return { text: 'WAITING FOR A PLAYER...', over: false };
  return { text: `${view.toMove} TO MOVE (${view.players[view.toMove]})`, over: false };
}

// ---- MCP calls -----------------------------------------------------------

const toolName = (call) => (call.method === 'tools/call' ? call.request.params?.name : null);
const isWait = (call) => toolName(call) === 'wait_for_turn';
const isMove = (call) => toolName(call) === 'make_move' && !call.failed;

function callStatus(call) {
  if (!call.response) return { text: 'NOTICE', cls: 'note' };
  if ('error' in call.response) return { text: 'ERROR', cls: 'error' };
  if (call.failed) return { text: 'REFUSED', cls: 'refused' };
  return { text: 'OK', cls: 'ok' };
}

function callSummary(call) {
  const params = call.request.params ?? {};
  if (call.method === 'tools/call') {
    const args = params.arguments && Object.keys(params.arguments).length ? ` ${JSON.stringify(params.arguments)}` : '';
    return `tools/call  ${params.name}${args}`;
  }
  if (call.method === 'resources/read') return `resources/read  ${params.uri}`;
  if (call.method === 'prompts/get') return `prompts/get  ${params.name}`;
  if (call.method === 'initialize') return `initialize  ${params.clientInfo?.name ?? ''} ${params.clientInfo?.version ?? ''}`;
  return call.method;
}

function whoCalled(call) {
  if (call.player) return `${call.player.mark} ${call.player.name ?? ''}`;
  return call.session ? `session ${call.session.slice(0, 8)}` : 'new session';
}

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour12: false }) + '.' + iso.slice(20, 23);

// The text inside a tool result holds the board with real line breaks.
// Shown on its own, it reads the way the model read it.
function resultTextOf(call) {
  const content = call.response?.result?.content;
  if (!Array.isArray(content)) return null;
  return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') || null;
}

function callDetail(call, colSpan) {
  const status = callStatus(call);
  const wire = [
    ['ENDPOINT', `${call.endpoint.http} ${call.endpoint.path}`],
    ['SESSION', `Mcp-Session-Id: ${call.session || '(assigned in the response)'}`],
    ['PROTOCOL', `MCP-Protocol-Version: ${call.endpoint.protocolVersion ?? '(not sent on initialize)'}`],
    ['JSON-RPC', `${call.method}${call.request.id !== undefined ? `  id ${call.request.id}` : '  (notification, no id, no reply)'}`],
    ['PLAYER', call.player ? `${call.player.mark} ${call.player.name ?? ''} at table ${call.table}` : 'not seated'],
    ['GAME', call.game ?? '-'],
    ['TIME', `${call.at}${call.ms != null ? `   answered in ${call.ms} ms` : ''}`],
    ['RESULT', status.text],
  ];
  const text = resultTextOf(call);
  return el('tr', { className: 'detail' }, el('td', { colSpan }, [
    el('dl', { className: 'wire' }, wire.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])),
    el('div', { className: 'panes' }, [
      el('div', {}, [el('div', { className: 'muted', textContent: 'REQUEST  client to server' }), el('pre', { textContent: JSON.stringify(call.request, null, 2) })]),
      call.response
        ? el('div', {}, [el('div', { className: 'muted', textContent: 'RESPONSE  server to client' }), el('pre', { textContent: JSON.stringify(call.response, null, 2) })])
        : null,
      text ? el('div', {}, [el('div', { className: 'muted', textContent: 'WHAT THE MODEL READ' }), el('pre', { textContent: text })]) : null,
    ]),
  ]));
}

// One row per call. mark(call) may add 'current' or 'future' for the replay.
function callRows(calls, { mark = () => '', onPick = null } = {}) {
  const rows = [];
  for (const call of calls) {
    if (hideWaits && isWait(call)) continue;
    const status = callStatus(call);
    const row = el('tr', { className: `call ${mark(call)}`.trim() }, [
      el('td', { textContent: clock(call.at) }),
      el('td', { textContent: whoCalled(call) }),
      el('td', { className: 'summary', textContent: callSummary(call) }),
      el('td', {}, el('span', { className: `tag ${status.cls}`, textContent: status.text })),
      el('td', { textContent: call.ms != null ? `${call.ms} ms` : '' }),
    ]);
    row.addEventListener('click', () => {
      openCall = openCall === call.seq ? null : call.seq;
      onPick?.(call);
      render();
    });
    rows.push(row);
    if (openCall === call.seq) rows.push(callDetail(call, 5));
  }
  return rows;
}

// ---- sections ------------------------------------------------------------

function renderTotals() {
  const games = state.history;
  const count = (test) => games.filter(test).length;
  const items = [
    ['GAMES', games.length],
    ['X WINS', count((g) => g.outcome.kind !== 'draw' && g.outcome.winner === 'X')],
    ['O WINS', count((g) => g.outcome.kind !== 'draw' && g.outcome.winner === 'O')],
    ['DRAWS', count((g) => g.outcome.kind === 'draw')],
    ['FORFEITS', count((g) => g.outcome.kind === 'forfeit')],
    ['MCP CALLS SEEN', traffic.length ? traffic[0].seq : 0],
  ];
  document.getElementById('totals').replaceChildren(...items.map(([label, n]) => el('div', {}, [`${label} `, el('b', { textContent: n })])));
}

function renderTables() {
  const box = document.getElementById('tables');
  document.getElementById('table-count').textContent = state.tables.length;
  if (state.tables.length === 0) {
    box.replaceChildren(el('div', { className: 'empty', textContent: 'NO GAMES IN PROGRESS. WAITING FOR PLAYERS.' }));
    return;
  }
  box.replaceChildren(...state.tables.map((view) => {
    const status = tableStatus(view);
    const winLine = view.outcome?.kind === 'win' ? view.outcome.line : [];
    return el('div', { className: 'card' }, [
      el('h3', {}, [el('span', { textContent: `TABLE ${view.table}` }), el('span', { className: 'empty', textContent: view.drawStreak ? `DRAWS ${view.drawStreak}` : '' })]),
      el('div', { className: 'players' }, ['X ', el('span', { textContent: view.players.X ?? '-' }), '  O ', el('span', { textContent: view.players.O ?? '-' })]),
      drawBoard(view.board, { winLine }),
      el('div', { className: `status${status.over ? ' over' : ''}`, textContent: status.text }),
      view.strangeGame ? el('div', { className: 'strange', textContent: 'A STRANGE GAME. THE ONLY WINNING MOVE IS NOT TO PLAY.' }) : null,
    ]);
  }));
}

function renderTraffic() {
  const body = document.getElementById('traffic');
  const rows = callRows(traffic.slice(0, TRAFFIC_SHOWN));
  body.replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { className: 'empty', textContent: 'NO MCP TRAFFIC YET.' }))]));
}

function renderHistory() {
  const body = document.getElementById('history');
  if (state.history.length === 0) {
    body.replaceChildren(el('tr', {}, el('td', { colSpan: 8, className: 'empty', textContent: 'NO GAMES PLAYED YET.' })));
    return;
  }
  body.replaceChildren(...state.history.map((game) => {
    const button = el('button', { textContent: selected === game.id ? 'CLOSE' : 'REPLAY' });
    button.addEventListener('click', () => select(selected === game.id ? null : game.id));
    return el('tr', { className: selected === game.id ? 'selected' : '' }, [
      el('td', { textContent: game.id }),
      el('td', { textContent: new Date(game.endedAt).toLocaleString(), title: game.endedAt }),
      el('td', { textContent: game.table }),
      el('td', { textContent: game.players.X ?? '-' }),
      el('td', { textContent: game.players.O ?? '-' }),
      el('td', { textContent: resultText(game.outcome, game.players) }),
      el('td', { textContent: game.moves.length }),
      el('td', {}, button),
    ]);
  }));
}

// Rebuilds the board after n moves. Marks alternate from whoever went first.
function boardAfter(game, n) {
  const cells = Array(9).fill(null);
  let mark = game.firstToMove;
  for (const square of game.moves.slice(0, n)) {
    cells[square - 1] = mark;
    mark = mark === 'X' ? 'O' : 'X';
  }
  return cells;
}

function winLineOf(cells) {
  return LINES.find(([a, b, c]) => cells[a - 1] && cells[a - 1] === cells[b - 1] && cells[a - 1] === cells[c - 1]) ?? [];
}

function renderReplay() {
  const box = document.getElementById('replay');
  const game = state.history.find((g) => g.id === selected);
  box.hidden = !game;
  if (!game) return;

  const total = game.moves.length;
  const cells = boardAfter(game, step);
  const goTo = (target) => { step = target; render(); };
  const controls = [['|<', 0], ['<', step - 1], ['>', step + 1], ['>|', total]].map(([label, target]) => {
    const b = el('button', { textContent: label, disabled: target < 0 || target > total || target === step });
    b.addEventListener('click', () => goTo(target));
    return b;
  });

  let mark = game.firstToMove;
  const moves = game.moves.map((square, i) => {
    const li = el('li', { textContent: `${mark} ON ${square}`, className: i + 1 === step ? 'current' : i + 1 > step ? 'future' : '' });
    li.addEventListener('click', () => goTo(i + 1));
    mark = mark === 'X' ? 'O' : 'X';
    return li;
  });

  // The successful make_move calls are the moves, in order. So move n is
  // the n-th of them, and anything after move n's call is still to come.
  const moveCalls = gameCalls.filter(isMove);
  const currentSeq = moveCalls[step - 1]?.seq;
  const nextSeq = moveCalls[step]?.seq ?? Infinity;
  const markCall = (call) => (call.seq === currentSeq ? 'current' : step < total && call.seq >= nextSeq ? 'future' : '');
  const pickCall = (call) => { if (isMove(call)) step = moveCalls.indexOf(call) + 1; };

  const heading = step === total ? `FINAL: ${resultText(game.outcome, game.players)}` : `AFTER MOVE ${step} OF ${total}`;
  const callRowsNow = callRows(gameCalls, { mark: markCall, onPick: pickCall });
  box.replaceChildren(el('div', { className: 'replay' }, [
    el('div', { className: 'top' }, [
      el('div', {}, [
        el('div', { textContent: `GAME ${game.id}  ${game.players.X ?? '-'} (X) VS ${game.players.O ?? '-'} (O)` }),
        el('div', { className: 'empty', textContent: heading }),
        el('div', { style: 'margin-top:10px' }, drawBoard(cells, { winLine: winLineOf(cells), last: game.moves[step - 1] ?? null })),
        el('div', { className: 'controls' }, controls),
      ]),
      el('ol', {}, moves),
    ]),
    el('h3', { textContent: `MCP CALLS IN THIS GAME (${gameCalls.length})` }),
    el('div', { className: 'muted', textContent: 'The highlighted call made the move on the board. Dim calls come later. Click a make_move to jump the board to it.' }),
    el('div', { className: 'scroll', style: 'margin-top:8px' }, el('table', { className: 'calls' }, el('tbody', {},
      callRowsNow.length ? callRowsNow : el('tr', {}, el('td', { className: 'empty', textContent: 'NO CALLS RECORDED FOR THIS GAME. IT MAY PREDATE THE CALL LOG.' }))))),
  ]));
}

async function select(id) {
  selected = id;
  openCall = null;
  const game = state.history.find((g) => g.id === id);
  step = game ? game.moves.length : 0;
  gameCalls = [];
  render();
  if (!game) return;
  const res = await fetch(`/api/games/${encodeURIComponent(game.game)}/calls`);
  if (selected === id) { gameCalls = await res.json(); render(); }
}

// ---- the command catalog -------------------------------------------------

function paramRows(schema) {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props).map(([name, p]) => {
    const limits = [p.minimum != null ? `min ${p.minimum}` : '', p.maximum != null ? `max ${p.maximum}` : ''].filter(Boolean).join(', ');
    return el('tr', {}, [
      el('td', { textContent: `${name}${required.has(name) ? '' : '?'}` }),
      el('td', { className: 'muted', textContent: `${p.type ?? ''}${limits ? ` (${limits})` : ''}` }),
      el('td', { textContent: p.description ?? '' }),
    ]);
  });
}

function exampleArgs(schema) {
  const args = {};
  for (const [name, p] of Object.entries(schema?.properties ?? {})) {
    args[name] = p.type === 'string' ? (name === 'name' ? 'Joshua' : '...') : p.minimum ?? 1;
  }
  return args;
}

function renderCatalog(catalog) {
  const hints = (a = {}) => Object.entries(a).filter(([k]) => k.endsWith('Hint')).map(([k, v]) => el('span', { textContent: `${k.replace('Hint', '')}: ${v}` }));
  const example = (method, params) => el('details', {}, [
    el('summary', { textContent: 'EXAMPLE REQUEST' }),
    el('pre', { textContent: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }, null, 2) }),
  ]);

  const tools = catalog.tools.map((t) => el('div', { className: 'tool' }, [
    el('div', { className: 'name', textContent: t.name }),
    el('div', { className: 'muted', textContent: `tools/call  ${t.title ?? ''}` }),
    el('div', { className: 'desc', textContent: t.description ?? '' }),
    el('div', { className: 'hints' }, hints(t.annotations)),
    el('table', { className: 'params' }, el('tbody', {}, paramRows(t.inputSchema).length ? paramRows(t.inputSchema) : el('tr', {}, el('td', { className: 'muted', textContent: 'no arguments' })))),
    example('tools/call', { name: t.name, arguments: exampleArgs(t.inputSchema) }),
  ]));

  const resources = catalog.resources.map((r) => el('div', { className: 'tool' }, [
    el('div', { className: 'name', textContent: r.uri }),
    el('div', { className: 'muted', textContent: `resources/read  ${r.mimeType ?? ''}` }),
    el('div', { className: 'desc', textContent: r.description ?? '' }),
    example('resources/read', { uri: r.uri }),
  ]));

  const prompts = catalog.prompts.map((p) => el('div', { className: 'tool' }, [
    el('div', { className: 'name', textContent: p.name }),
    el('div', { className: 'muted', textContent: `prompts/get  ${p.title ?? ''}` }),
    el('div', { className: 'desc', textContent: p.description ?? '' }),
    el('table', { className: 'params' }, el('tbody', {}, (p.arguments ?? []).map((a) => el('tr', {}, [
      el('td', { textContent: `${a.name}${a.required ? '' : '?'}` }), el('td', { className: 'muted', textContent: 'string' }), el('td', { textContent: a.description ?? '' }),
    ])))),
    el('div', { className: 'muted', textContent: `In Claude Code: /mcp__wopr__${p.name} Joshua 3` }),
    example('prompts/get', { name: p.name, arguments: { name: 'Joshua', games: '3' } }),
  ]));

  document.getElementById('catalog').replaceChildren(
    el('dl', { className: 'wire' }, [
      el('dt', { textContent: 'SERVER' }), el('dd', { textContent: `${catalog.server?.name ?? '?'} ${catalog.server?.version ?? ''}` }),
      el('dt', { textContent: 'ENDPOINT' }), el('dd', { textContent: `POST ${location.origin}${catalog.endpoint}   (Streamable HTTP, JSON-RPC 2.0)` }),
      el('dt', { textContent: 'PROTOCOL' }), el('dd', { textContent: catalog.protocolVersions.join(', ') }),
      el('dt', { textContent: 'CONNECT' }), el('dd', { textContent: `claude mcp add --transport http wopr ${location.origin}${catalog.endpoint}` }),
    ]),
    el('details', {}, [el('summary', { textContent: 'SERVER INSTRUCTIONS, SENT TO EVERY CLIENT AT INITIALIZE' }), el('pre', { textContent: catalog.instructions ?? '' })]),
    el('h3', { textContent: `PROTOCOL METHODS (${catalog.methods.length})`, style: 'margin-top:20px' }),
    el('div', { className: 'scroll' }, el('table', { className: 'methods' }, el('tbody', {}, catalog.methods.map((m) => el('tr', {}, [el('td', { textContent: m.method }), el('td', { textContent: m.does })]))))),
    el('h3', { textContent: `TOOLS (${catalog.tools.length})`, style: 'margin-top:20px' }), el('div', { className: 'tools' }, tools),
    el('h3', { textContent: `RESOURCES (${catalog.resources.length})`, style: 'margin-top:20px' }), el('div', { className: 'tools' }, resources),
    el('h3', { textContent: `PROMPTS (${catalog.prompts.length})`, style: 'margin-top:20px' }), el('div', { className: 'tools' }, prompts),
  );
}

// ---- wiring --------------------------------------------------------------

function render() {
  renderTotals();
  renderTables();
  renderTraffic();
  renderHistory();
  renderReplay();
}

document.getElementById('hide-waits').addEventListener('change', (e) => { hideWaits = e.target.checked; render(); });

// EventSource reconnects by itself. The label only tells the viewer.
function connect() {
  const link = document.getElementById('link');
  const events = new EventSource('/api/events');
  events.onopen = () => { link.textContent = 'LINK ESTABLISHED'; link.className = 'link live'; };
  events.onerror = () => { link.textContent = 'LINK LOST. RETRYING...'; link.className = 'link down'; };
  events.addEventListener('state', (message) => { state = JSON.parse(message.data); render(); });
  events.addEventListener('call', (message) => {
    const call = JSON.parse(message.data);
    traffic = [call, ...traffic].slice(0, 500);
    const game = state.history.find((g) => g.id === selected);
    if (game && call.game === game.game) gameCalls = [...gameCalls, call];
    render();
  });
}

render();
// Calls may arrive on the stream before this answers, so merge by seq.
fetch('/api/calls').then((r) => r.json()).then((calls) => {
  const seen = new Set(traffic.map((c) => c.seq));
  traffic = [...traffic, ...calls.filter((c) => !seen.has(c.seq))].sort((a, b) => b.seq - a.seq);
  render();
});
fetch('/api/catalog').then((r) => r.json()).then(renderCatalog);
connect();
