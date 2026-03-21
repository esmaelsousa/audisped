const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: (process.env.DB_USER || '').trim(),
    host: (process.env.DB_HOST || '').trim(),
    database: (process.env.DB_DATABASE || '').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    port: parseInt((process.env.DB_PORT || '5432').trim()),
});
async function main() {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'documentos_c100'");
    console.log(res.rows.map(r => r.column_name).join(', '));
    process.exit(0);
}
main();
