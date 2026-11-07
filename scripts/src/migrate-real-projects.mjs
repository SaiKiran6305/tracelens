import pg from "../../lib/db/node_modules/pg/lib/index.js";
import { readFile } from "node:fs/promises";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("../../lib/db/migrations/001_real_projects.sql", import.meta.url), "utf8"));
  console.log("Additive real-project migration applied; existing recordings preserved.");
} finally { await pool.end(); }
