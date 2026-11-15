import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SqliteDriver, SqliteValue } from './sqlite-game-repository';

export class CapacitorSqliteDriver implements SqliteDriver {
  private transactionQueue: Promise<void> = Promise.resolve();

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
    const previousTransaction = this.transactionQueue;
    let releaseTransaction!: () => void;
    this.transactionQueue = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    await previousTransaction;

    let transactionStarted = false;
    let committed = false;
    try {
      await this.connection.beginTransaction();
      transactionStarted = true;
      const result = await work();
      await this.connection.commitTransaction();
      committed = true;
      await this.afterCommit?.();
      return result;
    } catch (error) {
      if (transactionStarted && !committed) {
        await this.connection.rollbackTransaction();
      }
      throw error;
    } finally {
      releaseTransaction();
    }
  }
}
