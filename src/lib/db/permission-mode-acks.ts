import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

/** Every stored Bypass ack, oldest first. */
export function getPermissionModeAcks(db: IndexDb): string[]
{
	return db
		.select()
		.from(schema.permissionModeAcks)
		.all()
		.toSorted((a, b) => a.ackedAt - b.ackedAt || a.key.localeCompare(b.key))
		.map((row) => row.key);
}

/** Store an ack once; a repeat keeps its first time. */
export function addPermissionModeAck(db: IndexDb, key: string, now: number = Date.now()): void
{
	db.insert(schema.permissionModeAcks)
		.values(
			{
				key,
				ackedAt: now,
			},
		)
		.onConflictDoNothing()
		.run();
}
