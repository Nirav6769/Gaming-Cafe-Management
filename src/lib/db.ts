import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export type DatabaseRole = "admin" | "staff" | "customer";
export type DatabaseIdentity = {
  authUserId: string;
  role: DatabaseRole;
};

const identityStorage = new AsyncLocalStorage<DatabaseIdentity>();
const ROLE_BY_APP_ROLE: Record<DatabaseRole, string> = {
  admin: "gamehub_admin",
  staff: "gamehub_staff",
  customer: "gamehub_customer",
};

let identityResolver: (() => Promise<DatabaseIdentity | null>) | null = null;

export function registerIdentityResolver(
  resolver: () => Promise<DatabaseIdentity | null>,
): void {
  identityResolver = resolver;
}

export async function resolveCurrentIdentity(): Promise<DatabaseIdentity | null> {
  const store = identityStorage.getStore();
  if (store) return store;
  if (identityResolver) {
    try {
      const resolved = await identityResolver();
      if (resolved) {
        setDatabaseIdentity(resolved);
        return resolved;
      }
    } catch {
      return null;
    }
  }
  return null;
}

const globalForPg = globalThis as unknown as { pgPool?: Pool };
const rawPool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = rawPool;

type RawQuery = (text: string, values?: unknown[]) => Promise<QueryResult<QueryResultRow>>;

function sqlCommand(text: unknown): string {
  const sql =
    typeof text === "string"
      ? text
      : text && typeof text === "object" && "text" in text
        ? String((text as { text: unknown }).text)
        : "";
  return sql.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? "";
}

async function beginWithIdentity(
  rawQuery: RawQuery,
  identity: DatabaseIdentity,
): Promise<QueryResult<QueryResultRow>> {
  const beginResult = await rawQuery("BEGIN");
  try {
    const databaseRole = ROLE_BY_APP_ROLE[identity.role];
    await rawQuery("SET LOCAL ROLE " + databaseRole);
    await rawQuery(
      "SELECT set_config('gamehub.user_id', $1, TRUE)",
      [identity.authUserId],
    );
    return beginResult;
  } catch (error) {
    await rawQuery("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function instrumentClient(client: PoolClient): PoolClient {
  const mutable = client as unknown as {
    query: (text: string, values?: unknown[]) => Promise<QueryResult<QueryResultRow>>;
    release: (error?: Error | boolean) => void;
  };
  const originalQuery = client.query.bind(client) as unknown as RawQuery;
  const originalRelease = client.release.bind(client);
  let transactionIdentity: DatabaseIdentity | null = null;

  mutable.query = async (text: string, values?: unknown[]) => {
    let identity: DatabaseIdentity | null | undefined = identityStorage.getStore();
    if (!identity) {
      identity = await resolveCurrentIdentity();
    }
    const command = sqlCommand(text);

    if (!identity) {
      throw new Error(
        transactionIdentity
          ? "Database request identity was lost during an open transaction."
          : "Refusing a database connection without a verified Supabase identity.",
      );
    }

    if (command === "BEGIN" || command === "START") {
      if (transactionIdentity) {
        throw new Error("Nested database transactions are not supported.");
      }
      const beginResult = await beginWithIdentity(originalQuery, identity);
      transactionIdentity = identity;
      return beginResult;
    }

    if (command === "COMMIT" || command === "ROLLBACK") {
      if (transactionIdentity) {
        if (transactionIdentity.authUserId !== identity.authUserId) {
          throw new Error("Database transaction identity changed unexpectedly.");
        }
        const result = await originalQuery(text, values);
        transactionIdentity = null;
        return result;
      }
      return originalQuery(text, values);
    }

    if (transactionIdentity) {
      if (transactionIdentity.authUserId !== identity.authUserId) {
        throw new Error("Database transaction identity changed unexpectedly.");
      }
      return originalQuery(text, values);
    }

    await beginWithIdentity(originalQuery, identity);
    try {
      const result = await originalQuery(text, values);
      await originalQuery("COMMIT");
      return result;
    } catch (error) {
      await originalQuery("ROLLBACK").catch(() => undefined);
      throw error;
    }
  };

  mutable.release = (error?: Error | boolean) => {
    if (transactionIdentity) {
      transactionIdentity = null;
      void originalQuery("ROLLBACK")
        .catch(() => undefined)
        .finally(() => originalRelease(error));
      return;
    }
    originalRelease(error as Error | undefined);
  };

  return client;
}

async function scopedPoolQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Add your Supabase connection string to .env.local.",
    );
  }

  let identity: DatabaseIdentity | null | undefined = identityStorage.getStore();
  if (!identity) {
    identity = await resolveCurrentIdentity();
  }
  if (!identity) {
    throw new Error(
      "Refusing an application database query without a verified Supabase identity.",
    );
  }

  const client = await rawPool.connect();
  const rawQuery = client.query.bind(client) as RawQuery;

  try {
    await beginWithIdentity(rawQuery, identity);
    const result = await rawQuery(text, values);
    await rawQuery("COMMIT");
    return result as QueryResult<T>;
  } catch (error) {
    await rawQuery("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * All normal pool queries are fail-closed and use a transaction-local database
 * role plus identity. Explicit pool.connect() transactions are instrumented in
 * the same way when their BEGIN statement is issued.
 */
export const pool = new Proxy(rawPool, {
  get(target, property) {
    if (property === "query") return scopedPoolQuery;
    if (property === "connect") {
      return async () => instrumentClient(await rawPool.connect());
    }
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as Pool;

export function setDatabaseIdentity(identity: DatabaseIdentity): void {
  identityStorage.enterWith(identity);
}

/** Privileged lookup reserved for verifying the Supabase Auth -> app profile map. */
export async function systemQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Add your Supabase connection string to .env.local.",
    );
  }
  return rawPool.query<T>(text, values);
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected server error";
}
