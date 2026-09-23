import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FinishedGame } from './game/table.js';
import { History } from './history.js';

function game(winner: 'X' | 'O'): FinishedGame {
  return {
    table: '1',
    game: 'g-1',
    players: { X: 'Joshua', O: 'Falken' },
    firstToMove: 'X',
    moves: [1, 4, 2, 5, 3],
    outcome: { kind: 'forfeit', winner },
    startedAt: '2026-09-23T12:00:00.000Z',
    endedAt: '2026-09-23T12:01:00.000Z',
  };
}

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'wopr-history-')), 'nested', 'history.jsonl');
}

test('games get rising ids and are listed newest first', () => {
  const history = new History();
  history.record(game('X'));
  history.record(game('O'));
  assert.deepEqual(history.list().map((g) => g.id), [2, 1]);
  assert.equal(history.get(1)?.outcome.kind, 'forfeit');
});

test('games are written one per line and read back after a restart', () => {
  const file = tempFile();
  new History(file).record(game('X'));
  new History(file).record(game('O'));

  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);
  const reloaded = new History(file);
  assert.deepEqual(reloaded.list().map((g) => g.id), [2, 1]);
  assert.deepEqual(reloaded.get(1)?.moves, [1, 4, 2, 5, 3]);
});

test('a damaged line is skipped and the rest still load', () => {
  const file = tempFile();
  new History(file).record(game('X'));
  appendFileSync(file, '{"half a line\n');
  const messages: string[] = [];
  const history = new History(file, (m) => messages.push(m));
  assert.equal(history.list().length, 1);
  assert.match(messages.join('\n'), /skipped damaged line 2/);
});
