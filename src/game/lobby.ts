// All the tables, and which player sits at which. A player never picks a
// table: the lobby seats them where somebody is already waiting, or opens a
// new table. That keeps the MCP tools the same as with one table.

import type { Mark } from './rules.js';
import { Table, type FinishedGame, type PlayerId, type Result, type TableView } from './table.js';

export class Lobby {
  private tables = new Map<string, { table: Table; unsubscribe: () => void }>();
  private seatedAt = new Map<PlayerId, Table>();
  private nextId = 1;
  private listeners = new Set<() => void>();
  private finishListeners = new Set<(game: FinishedGame) => void>();

  constructor(private now: () => number = Date.now) {}

  join(id: PlayerId, name: string): Result<{ table: string; mark: Mark }> {
    const table = this.seatedAt.get(id) ?? this.openSeat();
    const result = table.join(id, name);
    if (!result.ok) return result;
    this.seatedAt.set(id, table);
    return { ok: true, value: { table: table.id, mark: result.value } };
  }

  leave(id: PlayerId): Result<null> {
    const table = this.seatedAt.get(id);
    if (!table) return { ok: false, error: 'not_seated' };
    this.seatedAt.delete(id);
    const result = table.leave(id);
    // A table nobody sits at has nothing left to show. Its finished games
    // were already reported through onFinish.
    if (table.isEmpty()) this.close(table);
    this.changed();
    return result;
  }

  tableOf(id: PlayerId): Table | undefined {
    return this.seatedAt.get(id);
  }

  views(): TableView[] {
    return [...this.tables.values()].map(({ table }) => table.view());
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFinish(listener: (game: FinishedGame) => void): () => void {
    this.finishListeners.add(listener);
    return () => this.finishListeners.delete(listener);
  }

  // A player already waiting for an opponent gets one before anyone
  // starts a new table.
  private openSeat(): Table {
    for (const { table } of this.tables.values()) {
      if (table.hasFreeSeat() && !table.isEmpty()) return table;
    }
    return this.open();
  }

  private open(): Table {
    const table = new Table(String(this.nextId++), this.now);
    const offChange = table.onChange(() => this.changed());
    const offFinish = table.onFinish((game) => {
      for (const listener of [...this.finishListeners]) listener(game);
    });
    this.tables.set(table.id, { table, unsubscribe: () => (offChange(), offFinish()) });
    return table;
  }

  private close(table: Table): void {
    this.tables.get(table.id)?.unsubscribe();
    this.tables.delete(table.id);
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
