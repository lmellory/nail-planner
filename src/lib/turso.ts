// D1-совместимый адаптер для базы данных Turso (libSQL)
import { createClient, type Client } from '@libsql/client/web';

export function createTursoD1(url: string, authToken: string): D1Database {
  const client: Client = createClient({ url, authToken });

  class TursoPreparedStatement implements D1PreparedStatement {
    constructor(
      private sql: string,
      private params: any[] = [],
    ) {}

    bind(...values: any[]): D1PreparedStatement {
      return new TursoPreparedStatement(this.sql, values);
    }

    async first<T = unknown>(colName?: string): Promise<T | null> {
      const res = await client.execute({ sql: this.sql, args: this.params });
      if (!res.rows.length) return null;
      const firstRow = res.rows[0];
      if (colName) {
        return (firstRow as any)[colName] as T;
      }
      return firstRow as unknown as T;
    }

    async all<T = unknown>(): Promise<D1Result<T>> {
      const res = await client.execute({ sql: this.sql, args: this.params });
      return {
        results: res.rows as unknown as T[],
        success: true,
        meta: {
          changes: res.rowsAffected,
          last_row_id: Number(res.lastInsertRowid ?? 0),
          duration: 0,
          rows_read: res.rows.length,
          rows_written: res.rowsAffected,
          size_after: 0,
        } as any,
      };
    }

    async run<T = unknown>(): Promise<D1Result<T>> {
      const res = await client.execute({ sql: this.sql, args: this.params });
      return {
        results: [] as T[],
        success: true,
        meta: {
          changes: res.rowsAffected,
          last_row_id: Number(res.lastInsertRowid ?? 0),
          duration: 0,
          rows_read: 0,
          rows_written: res.rowsAffected,
          size_after: 0,
        } as any,
      };
    }

    raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
    raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<any> {
      const res = await client.execute({ sql: this.sql, args: this.params });
      const rows = res.rows as unknown as T[];
      if (options?.columnNames) {
        return [res.columns, ...rows];
      }
      return rows;
    }
  }

  return {
    prepare(query: string): D1PreparedStatement {
      return new TursoPreparedStatement(query);
    },
    async dump(): Promise<ArrayBuffer> {
      throw new Error('Not implemented');
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        results.push(await stmt.all<T>());
      }
      return results;
    },
    async exec(query: string): Promise<D1ExecResult> {
      await client.executeMultiple(query);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
}
