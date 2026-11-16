/* eslint-disable no-console */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const cfg = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rekana',
  };
  try {
    const conn = await mysql.createConnection({ ...cfg, charset: 'utf8mb4' });
    const [rows] = await conn.query(
      `SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM categories) AS categories,
        (SELECT COUNT(*) FROM weather_forecasts) AS weather,
        (SELECT COUNT(*) FROM disaster_warnings) AS warnings,
        (SELECT COUNT(*) FROM incidents) AS incidents,
        (SELECT COUNT(*) FROM admin_users) AS admins`,
    );
    console.log('Koneksi MySQL berhasil:', `${cfg.host}:${cfg.port}/${cfg.database}`);
    console.log(rows[0]);
    await conn.end();
  } catch (err) {
    console.error('Koneksi MySQL gagal:', err.message);
    process.exitCode = 1;
  }
})();
