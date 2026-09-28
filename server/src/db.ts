import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const url = process.env.DATABASE_URL;
let pool: pg.Pool | null = null;
if (url) {
  pool = new pg.Pool({ connectionString: url, max: 5 });
  pool.on('error', () => {});
}

export const db = pool ? drizzle(pool) : null;
export const hasDb = () => db !== null;
