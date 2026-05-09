const { Pool } = require('pg');
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_n2D8wshLpGje@ep-old-cloud-a5h518u1-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
});

async function run() {
  const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'de_para_xml'");
  console.log(JSON.stringify(res.rows, null, 2));
  await pool.end();
}

run();
