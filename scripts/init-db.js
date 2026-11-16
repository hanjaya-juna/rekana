/* eslint-disable no-console */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rekana',
};

const CATEGORIES = [
  ['Perlindungan Diri', '#22385a', 1],
  ['Kesehatan & P3K', '#7a2e1a', 2],
  ['Penerangan & Sinyal', '#7a5d00', 3],
  ['Logistik', '#3d5a2a', 4],
];

const PRODUCTS = [
  ['p-seed1', 'Tas Siaga Bencana 30L', 'Perlindungan Diri', 250000, 12, 'Tas ransel berisi ruang untuk dokumen, obat, dan perbekalan 72 jam.', 1],
  ['p-seed2', 'Helm Pelindung Ringan', 'Perlindungan Diri', 120000, 8, 'Helm ringan untuk melindungi kepala dari reruntuhan kecil.', 0],
  ['p-seed3', 'Kotak P3K Lengkap', 'Kesehatan & P3K', 85000, 20, 'Perban, antiseptik, gunting, dan sarung tangan untuk pertolongan pertama.', 1],
  ['p-seed4', 'Masker Debu (isi 10)', 'Kesehatan & P3K', 30000, 3, 'Masker sekali pakai untuk debu dan abu.', 0],
  ['p-seed5', 'Senter LED Isi Ulang', 'Penerangan & Sinyal', 95000, 15, 'Senter terang dengan baterai isi ulang lewat USB.', 0],
  ['p-seed6', 'Peluit Darurat', 'Penerangan & Sinyal', 15000, 0, 'Peluit nyaring untuk memberi tanda saat butuh pertolongan.', 0],
  ['p-seed7', 'Paket Air Minum Darurat', 'Logistik', 60000, 25, 'Air kemasan tahan simpan untuk kebutuhan 3 hari.', 1],
  ['p-seed8', 'Selimut Darurat Termal', 'Logistik', 40000, 5, 'Selimut tipis pemantul panas, ringan dan mudah dilipat.', 0],
];

const WEATHER = [
  [0, 'Hujan Lebat', 24, 29, 85, 'Siaga'],
  [1, 'Hujan Sedang', 24, 30, 70, 'Waspada'],
  [2, 'Berawan', 25, 31, 40, 'Normal'],
  [3, 'Cerah Berawan', 25, 32, 20, 'Normal'],
  [4, 'Hujan Ringan', 24, 30, 55, 'Waspada'],
  [5, 'Hujan Petir', 24, 29, 80, 'Waspada'],
  [6, 'Cerah', 25, 33, 10, 'Normal'],
  [7, 'Berawan', 25, 31, 35, 'Normal'],
];

const NEWS = [
  ['Genangan di permukiman bantaran sungai', 'Air meluap setelah hujan deras semalam. Warga diminta menyiapkan tas siaga dan memantau tinggi muka air.', 'Banjir', 'Bantaran Sungai Contoh', -7.250000, 112.750000, 6, 15, 'published'],
  ['Retakan tanah di lereng perbukitan', 'Petugas memeriksa retakan baru. Warga di sekitar lereng diimbau waspada saat hujan lebat.', 'Longsor', 'Lereng Bukit Contoh', -7.300000, 112.700000, 9, 40, 'published'],
  ['Gempa ringan terasa singkat', 'Getaran berkekuatan kecil tercatat tanpa laporan kerusakan. Tetap tenang dan kenali jalur evakuasi.', 'Gempa', 'Wilayah Pesisir Contoh', -7.200000, 112.800000, 11, 5, 'published'],
  ['Pohon tumbang menutup akses jalan', 'Petugas kebersihan dan relawan sedang menyingkirkan batang pohon. Pengendara diminta mencari jalur alternatif.', 'Cuaca Ekstrem', 'Jalan Raya Contoh', -7.280000, 112.720000, 13, 30, 'published'],
  ['Saluran air tersumbat di permukiman', 'Laporan warga: air mulai menggenang di gang. Perlu pemeriksaan saluran sebelum hujan berikutnya.', 'Banjir', 'Gang Melati Contoh', -7.255000, 112.755000, 14, 10, 'pending'],
  ['Bau gas menyengat di dekat pasar', 'Warga melaporkan bau gas. Petugas diminta memeriksa sumber bau dan memastikan area aman.', 'Kebakaran', 'Pasar Contoh', -7.265000, 112.740000, 14, 45, 'pending'],
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateOnly(offsetDays = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateTime(offsetHours = 0, minutes = 0) {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes + offsetHours * 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function incidentTime(offsetDays, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(hour)}:${pad(minute)}:00`;
}

async function main() {
  console.log('REKANA - inisialisasi MySQL');
  console.log(`Host: ${cfg.host}:${cfg.port}, database: ${cfg.database}, user: ${cfg.user}`);

  if (!process.env.ADMIN_PASSWORD) {
    console.error('\nADMIN_PASSWORD belum diisi di .env.');
    console.error('Isi password admin yang kuat sebelum menjalankan db:init.');
    process.exitCode = 1;
    return;
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      multipleStatements: true,
      charset: 'utf8mb4',
    });
  } catch (err) {
    console.error('\nGagal terhubung ke MySQL:', err.message);
    console.error('\nPeriksa berkas .env:');
    console.error('  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME');
    console.error('Pastikan layanan MySQL80 sudah berjalan (services.msc).');
    process.exitCode = 1;
    return;
  }

  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    await conn.query(schema);
    await conn.changeUser({ database: cfg.database });
    console.log('Skema database siap.');

    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD;
    const fullName = process.env.ADMIN_NAME || 'Administrator REKANA';
    const hash = await bcrypt.hash(password, 10);

    await conn.execute(
      `INSERT INTO admin_users (username, password_hash, full_name)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name)`,
      [username, hash, fullName],
    );
    const [[admin]] = await conn.execute('SELECT id, username FROM admin_users WHERE username = ?', [username]);
    console.log(`Akun admin siap: ${admin.username}`);

    for (const [name, color, order] of CATEGORIES) {
      await conn.execute(
        `INSERT INTO categories (name, color, sort_order)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE color = VALUES(color), sort_order = VALUES(sort_order)`,
        [name, color, order],
      );
    }
    const [catRows] = await conn.query('SELECT id, name FROM categories');
    const catId = Object.fromEntries(catRows.map((c) => [c.name, c.id]));

    for (const [id, name, category, price, stock, description, featured] of PRODUCTS) {
      await conn.execute(
        `INSERT IGNORE INTO products
          (id, name, category_id, price, stock, description, image_url, featured)
         VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
        [id, name, catId[category], price, stock, description, featured],
      );
    }

    const [[{ count: weatherCount }]] = await conn.query('SELECT COUNT(*) AS count FROM weather_forecasts');
    if (weatherCount === 0) {
      for (const [offset, condition, min, max, rain, level] of WEATHER) {
        await conn.execute(
          `INSERT INTO weather_forecasts
            (forecast_date, condition_text, temp_min, temp_max, rain_chance, alert_level, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [dateOnly(offset), condition, min, max, rain, level, admin.id],
        );
      }
    }

    const [[{ count: warningCount }]] = await conn.query('SELECT COUNT(*) AS count FROM disaster_warnings');
    if (warningCount === 0) {
      await conn.execute(
        `INSERT INTO disaster_warnings
          (title, message, level, area, starts_at, ends_at, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          'Peringatan dini banjir',
          'Curah hujan tinggi diperkirakan berlanjut. Warga di bantaran sungai diminta memantau kenaikan air dan menyiapkan jalur evakuasi.',
          'Siaga',
          'Daerah aliran sungai',
          dateTime(-2),
          dateTime(10),
          admin.id,
        ],
      );
      await conn.execute(
        `INSERT INTO disaster_warnings
          (title, message, level, area, starts_at, ends_at, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          'Angin kencang di wilayah pesisir',
          'Angin kencang dan gelombang tinggi berpotensi terjadi hingga malam. Hindari aktivitas di tepi pantai.',
          'Waspada',
          'Wilayah pesisir',
          dateTime(0),
          dateTime(18),
          admin.id,
        ],
      );
    }

    const [[{ count: incidentCount }]] = await conn.query('SELECT COUNT(*) AS count FROM incidents');
    if (incidentCount === 0) {
      for (const [title, summary, type, location, lat, lng, hour, minute, status] of NEWS) {
        await conn.execute(
          `INSERT INTO incidents
            (title, summary, type, location, lat, lng, occurred_at, status, reporter_name, reporter_contact)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
          [title, summary, type, location, lat, lng, incidentTime(0, hour, minute), status, status === 'pending' ? 'Warga Contoh' : 'Relawan Contoh'],
        );
      }
    }

    const [[products]] = await conn.query('SELECT COUNT(*) AS n FROM products');
    const [[weather]] = await conn.query('SELECT COUNT(*) AS n FROM weather_forecasts');
    const [[warnings]] = await conn.query('SELECT COUNT(*) AS n FROM disaster_warnings');
    const [[incidents]] = await conn.query('SELECT COUNT(*) AS n FROM incidents');

    console.log('');
    console.log('Inisialisasi selesai:');
    console.log(`  Produk       : ${products.n}`);
    console.log(`  Cuaca        : ${weather.n} hari`);
    console.log(`  Peringatan   : ${warnings.n}`);
    console.log(`  Kejadian     : ${incidents.n}`);
    console.log('');
    console.log(`Login admin   : ${username} (password sesuai ADMIN_PASSWORD di .env)`);
    console.log('Ganti password lewat ADMIN_PASSWORD di .env lalu jalankan npm run db:init lagi.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('\nInisialisasi gagal:', err.message);
  process.exitCode = 1;
});
