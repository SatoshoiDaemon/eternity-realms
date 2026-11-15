import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SqliteDriver, SqliteValue } from './sqlite-game-repository';

export class CapacitorSqliteDriver implements SqliteDriver {
  constructor(
    private readonly connection: SQLiteDBConnection,
    private readonly afterCommit?: () => Promise<void>,
  ) {}

  async execute(sql: string): Promise<void> {
    await this.connection.execute(sql, false);
  }

  async run(sql: string, values: SqliteValue[] = []): Promise<void> {
    await this.connection.run(sql, values, false);
  }

  async query<T>(sql: string, values: SqliteValue[] = []): Promise<T[]> {
    const result = await this.connection.query(sql, values);
    return (result.values ?? []) as T[];
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.connection.beginTransaction();
    let committed = false;
    try {
      const result = await work();
      await this.connection.commitTransaction();
      committed = true;
      await this.afterCommit?.();
      return result;
    } catch (error) {
      if (!committed) {
        await this.connection.rollbackTransaction();
      }
      throw error;
    }
  }
}
