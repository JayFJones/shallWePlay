// Every finished game, kept in memory for the admin panel and appended to a
// file so it survives a restart. One JSON object per line: appending never
// rewrites what is already there, and a crash mid-write costs one line.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FinishedGame } from './game/table.js';

export interface RecordedGame extends FinishedGame {
  id: number;
}

export class History {
  private games: RecordedGame[] = [];

  // No file means memory only, which is what the tests use.
  constructor(
    private file: string | null = null,
    private log: (message: string) => void = () => {},
  ) {
    if (file && existsSync(file)) this.load(file);
  }

  record(game: FinishedGame): RecordedGame {
    const recorded = { id: (this.games.at(-1)?.id ?? 0) + 1, ...game };
    this.games.push(recorded);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${JSON.stringify(recorded)}\n`);
    }
    return recorded;
  }

  // Newest first, which is the order anyone looking at a history wants.
  list(): RecordedGame[] {
    return [...this.games].reverse();
  }

  get(id: number): RecordedGame | undefined {
    return this.games.find((g) => g.id === id);
  }

  // A damaged line is skipped, not fatal. Losing one game from the history
  // is better than a server that will not start.
  private load(file: string): void {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try {
        this.games.push(JSON.parse(line) as RecordedGame);
      } catch {
        this.log(`history: skipped damaged line ${i + 1} in ${file}`);
      }
    });
    this.log(`history: loaded ${this.games.length} games from ${file}`);
  }
}
