const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: String(process.env.DB_PASSWORD),
  port: parseInt(process.env.DB_PORT || '5432')
});

async function checkFKs() {
    const client = await pool.connect();
    try {
        const res1 = await client.query(`
            SELECT tc.table_name, rc.delete_rule
            FROM information_schema.table_constraints AS tc 
            JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            JOIN information_schema.referential_constraints AS rc
            ON tc.constraint_name = rc.constraint_name
            WHERE constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'empresas';
        `);
        console.log('Dependencies on empresas:', res1.rows);

        const res2 = await client.query(`
            SELECT tc.table_name, rc.delete_rule
            FROM information_schema.table_constraints AS tc 
            JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            JOIN information_schema.referential_constraints AS rc
            ON tc.constraint_name = rc.constraint_name
            WHERE constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'sped_arquivos';
        `);
        console.log('Dependencies on sped_arquivos:', res2.rows);
    } catch(e) {
        console.error(e);
    } finally {
        client.release();
        process.exit();
    }
}
checkFKs();
