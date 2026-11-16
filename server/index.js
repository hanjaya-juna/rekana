'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const { pool, ping, DB_NAME } = require('./db');
const publicRoutes = require('./public-routes');
const adminRoutes = require('./admin-routes');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, '..');

app.disable('x-powered-by');
app.set('trust proxy', false);

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' http://localhost:3000 http://127.0.0.1:3000",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
});

// Izinkan prototipe dibuka langsung dari file:// (origin "null") untuk pengembangan lokal.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed =
    origin === 'null' ||
    origin === `http://localhost:${PORT}` ||
    origin === `http://127.0.0.1:${PORT}`;
  if (origin && allowed) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.use(express.json({ limit: '200kb' }));

app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

app.get('/api/health', async (req, res) => {
  try {
    await ping();
    res.json({ ok: true, database: DB_NAME, time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, database: DB_NAME, message: err.message });
  }
});

// Berkas antarmuka disajikan satu per satu agar berkas server/.env tidak pernah terekspos.
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(ROOT, 'app.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(ROOT, 'styles.css')));
app.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '1h', fallthrough: false }));

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, message: 'Endpoint API tidak ditemukan.' });
});

app.use((req, res) => {
  res.status(404).send('Halaman tidak ditemukan. Buka alamat utama aplikasi REKANA.');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (res.headersSent) return;
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_JSON',
      message: 'Format JSON pada permintaan tidak valid.',
    });
  }
  const dbDown =
    err.code === 'ECONNREFUSED' ||
    err.code === 'PROTOCOL_CONNECTION_LOST' ||
    err.code === 'ER_ACCESS_DENIED_ERROR' ||
    err.code === 'ER_BAD_DB_ERROR' ||
    err.code === 'ENOTFOUND';
  res.status(dbDown ? 503 : 500).json({
    ok: false,
    message: dbDown
      ? 'Basis data MySQL belum dapat dihubungi. Periksa layanan MySQL dan berkas .env.'
      : 'Terjadi kesalahan pada server. Coba lagi.',
  });
});

const server = app.listen(PORT, async () => {
  console.log('');
  console.log('REKANA berjalan di http://localhost:' + PORT);
  console.log(`Database tujuan: ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${DB_NAME}`);
  try {
    await ping();
    console.log('Koneksi MySQL: OK');
  } catch (err) {
    console.warn('Koneksi MySQL: GAGAL -', err.message);
    console.warn('Jalankan `npm run db:init` setelah mengisi DB_PASSWORD di .env.');
  }
  console.log('');
});

async function shutdown(signal) {
  console.log(`\nMenerima ${signal}, menutup server...`);
  server.close(async () => {
    try {
      await pool.end();
    } finally {
      process.exit(0);
    }
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
