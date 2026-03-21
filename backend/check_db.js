const { Client } = require('pg');
require('dotenv').config({ path: '.env' });
const client = new Client({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_DATABASE || 'audisped_db',
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});
async function run() {
  await client.connect();
  const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'lmc_tanques_config';");
  console.log(res.rows);
  await client.end();
}
run().catch(console.error);
