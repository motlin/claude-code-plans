import {eq, sql} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import {z} from "zod";
import {BridgeSessionRecordSchema} from "../schemas";
import {foldJsonl} from "../incremental-jsonl";
import * as schema from "./schema";

type IndexDb = BetterSQLite3Database<typeof schema>;

const BridgeAliasesSchema = z.object({aliases: z.array(z.string()), canonical: z.string().nullable()}).strict();
type BridgeAliases = z.infer<typeof BridgeAliasesSchema>;
const OwnersSchema = z.array(z.string());
const LOCAL_PREFIX = "bridge:v1:local:";
const ALIAS_PREFIX = "bridge:v1:alias:";

export function sessionBridgeMetadataKey(sessionId: string): string {
	return `${LOCAL_PREFIX}${sessionId}`;
}

/** Two surviving owners suffice to distinguish missing, unique and ambiguous indexed aliases. */
export function getSessionBridgeOwners(db: IndexDb, routeId: string): string[] {
	return db
		.all<{sessionId: string}>(sql`
			SELECT DISTINCT ${schema.sessions.id} AS sessionId
			FROM ${schema.metadata}, json_each(${schema.metadata.value}) AS bridge_owner
			JOIN ${schema.sessions} ON ${schema.sessions.id} = bridge_owner.value
			WHERE ${schema.metadata.key} = ${`${ALIAS_PREFIX}${routeId}`}
			LIMIT 2
		`)
		.map(({sessionId}) => sessionId);
}

/** Correlate with the detail query's session row without adding another SQL statement. */
export const canonicalSessionRouteId = sql<string | null>`(
	SELECT json_extract(local_bridge.value, '$.canonical')
	FROM ${schema.metadata} AS local_bridge
	WHERE local_bridge.key = ${LOCAL_PREFIX} || ${schema.sessions.id}
	AND ${schema.sessions.id} = (
		SELECT min(live_owner.id)
		FROM ${schema.metadata} AS remote_bridge, json_each(remote_bridge.value) AS bridge_owner
		JOIN ${schema.sessions} AS live_owner ON live_owner.id = bridge_owner.value
		WHERE remote_bridge.key = ${ALIAS_PREFIX} || json_extract(local_bridge.value, '$.canonical')
		HAVING count(DISTINCT live_owner.id) = 1
	)
)`;

/** Bridge records travel with copied transcripts; only claim records belonging to this local session. */
export class BridgeSessionCollector {
	private readonly aliases = new Set<string>();
	private canonical: string | null = null;
	private dirty = true;
	private persistedDatabase: IndexDb | undefined;

	add(record: unknown, localSessionId: string): void {
		const parsed = BridgeSessionRecordSchema.safeParse(record);
		if (!parsed.success) return;
		const {sessionId, bridgeSessionId} = parsed.data;
		if (sessionId !== undefined && sessionId !== localSessionId) return;
		if (bridgeSessionId === undefined || !/^(?:cse|session)_[A-Za-z0-9_-]+$/.test(bridgeSessionId)) return;
		const canonical = bridgeSessionId.replace(/^cse_/, "session_");
		if (canonical !== this.canonical) this.dirty = true;
		this.canonical = canonical;
		this.aliases.add(this.canonical);
	}

	/** Ordinary live appends do not change bridge identity and need no metadata query. */
	persist(db: IndexDb, sessionId: string): void {
		if (!this.dirty && this.persistedDatabase === db) return;
		updateAliases(db, sessionId, {aliases: [...this.aliases].sort(), canonical: this.canonical});
		this.persistedDatabase = db;
		this.dirty = false;
	}
}

function readMetadata(db: IndexDb, key: string): string | undefined {
	return db.select({value: schema.metadata.value}).from(schema.metadata).where(eq(schema.metadata.key, key)).get()
		?.value;
}

function writeMetadata(db: IndexDb, key: string, value: string): void {
	db.insert(schema.metadata)
		.values({key, value})
		.onConflictDoUpdate({target: schema.metadata.key, set: {value}})
		.run();
}

/** Keep every owner so an ambiguous remote alias can never silently select a different local transcript. */
function updateAliases(db: IndexDb, sessionId: string, next: BridgeAliases | null): void {
	db.transaction(() => {
		const key = sessionBridgeMetadataKey(sessionId);
		const previousValue = readMetadata(db, key);
		const nextValue = next === null ? undefined : JSON.stringify(next);
		if (previousValue === nextValue) return;
		const previous = previousValue === undefined ? null : BridgeAliasesSchema.parse(JSON.parse(previousValue));
		const nextAliases = new Set(next?.aliases);
		for (const alias of new Set([...(previous?.aliases ?? []), ...nextAliases])) {
			const aliasKey = `${ALIAS_PREFIX}${alias}`;
			const ownerValue = readMetadata(db, aliasKey);
			const owners = new Set(ownerValue === undefined ? [] : OwnersSchema.parse(JSON.parse(ownerValue)));
			if (nextAliases.has(alias)) owners.add(sessionId);
			else owners.delete(sessionId);
			if (owners.size === 0) db.delete(schema.metadata).where(eq(schema.metadata.key, aliasKey)).run();
			else writeMetadata(db, aliasKey, JSON.stringify([...owners].sort()));
		}
		if (nextValue === undefined) db.delete(schema.metadata).where(eq(schema.metadata.key, key)).run();
		else writeMetadata(db, key, nextValue);
	});
}

export function replaceSessionBridgeAliases(db: IndexDb, sessionId: string, collector: BridgeSessionCollector): void {
	collector.persist(db, sessionId);
}

export function deleteSessionBridgeAliases(db: IndexDb, sessionId: string): void {
	updateAliases(db, sessionId, null);
}

/** Fill the missing marker for an unchanged transcript without rebuilding its messages or search rows. */
export async function backfillSessionBridgeAliases(db: IndexDb, filePath: string, sessionId: string): Promise<void> {
	const collector = await foldJsonl(filePath, {
		create: () => new BridgeSessionCollector(),
		add: (state, line) => {
			if (!line.includes('"bridge-session"')) return;
			try {
				state.add(JSON.parse(line), sessionId);
			} catch {
				// Ignore malformed records, as the regular transcript fold does.
			}
		},
	});
	// A watcher may have indexed this session, or moved it, while the stream yielded.
	const session = db
		.select({filePath: schema.sessions.filePath, bridgeMetadataKey: schema.metadata.key})
		.from(schema.sessions)
		.leftJoin(schema.metadata, eq(schema.metadata.key, sessionBridgeMetadataKey(sessionId)))
		.where(eq(schema.sessions.id, sessionId))
		.get();
	if (session?.filePath === filePath && session.bridgeMetadataKey === null) collector.persist(db, sessionId);
}
