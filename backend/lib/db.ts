import { Pool, type PoolClient, type QueryResultRow } from 'pg'

declare global {
  var posErpPool: Pool | undefined
}

const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    }

export const db = global.posErpPool || new Pool({
  ...connection,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

if (process.env.NODE_ENV !== 'production') global.posErpPool = db

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function rows<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  return (await db.query<T>(text, values)).rows
}
