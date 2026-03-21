const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function run() {
    try {
        const res = await pool.query("SELECT * FROM mde_cache LIMIT 1");
        console.log("Cols:", Object.keys(res.rows[0]));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
