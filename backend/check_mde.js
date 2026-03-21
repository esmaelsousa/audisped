const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});

async function check() {
    try {
        const res = await pool.query('SELECT chave_nfe, status_manifesto, xml_content IS NOT NULL as has_xml FROM mde_cache ORDER BY id DESC LIMIT 10');
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

check();
