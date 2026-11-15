import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { SqliteDriver, SqliteValue } from '../persistence/sqlite-game-repository';

let sqlPromise: Promise<SqlJsStatic> | undefined;

async function loadSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({
    locateFile: (file) => new URL(`../../node_modules/sql.js/dist/${file}`, import.meta.url).href,
  });
  return sqlPromise;
}

export class SqlJsDriver implements SqliteDriver {
  private constructor(private readonly database: Database) {}

  static async create(bytes?: Uint8Array): Promise<SqlJsDriver> {
    const SQL = await loadSql();
    return new SqlJsDriver(bytes ? new SQL.Database(bytes) : new SQL.Database());
  }

  async execute(sql: string): Promise<void> {
    this.database.run(sql);
  }

  async run(sql: string, values: SqliteValue[] = []): Promise<void> {
    this.database.run(sql, values);
  }

  async query<T>(sql: string, values: SqliteValue[] = []): Promise<T[]> {
    const statement = this.database.prepare(sql, values);
    const rows: T[] = [];
    try {
      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }
    } finally {
      statement.free();
    }
    return rows;
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    this.database.run('BEGIN IMMEDIATE');
    try {
      const result = await work();
      this.database.run('COMMIT');
      return result;
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
  }

  export(): Uint8Array {
    return this.database.export();
  }

  close(): void {
    this.database.close();
  }
}
