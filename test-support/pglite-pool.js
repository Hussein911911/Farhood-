import { PGlite } from '@electric-sql/pglite';

export async function createTestPool() {
  const database = new PGlite();
  const query = (text, values) => database.query(text, values);
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
    async end() {
      await database.close();
    },
    database,
  };
}
