import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import { getCacheDir } from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

export type ReadonlyIndexDb = BetterSQLite3Database<typeof schema>;

export interface CorpusDatabase {
  index: ReadonlyIndexDb;
  sqlite: Database.Database;
  close(): void;
}

export function openCorpusDatabase(cacheDir: string = getCacheDir()): CorpusDatabase {
  const sqlite = new Database(join(cacheDir, "index.db"), {
    readonly: true,
    fileMustExist: true,
  });
  sqlite.pragma("query_only = ON");
  const index = drizzle(sqlite, { schema });
  return {
    index,
    sqlite,
    close() {
      sqlite.close();
    },
  };
}
