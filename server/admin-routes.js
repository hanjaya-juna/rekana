'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('./db');
const { requireAdmin, signToken } = require('./auth');
const { getAdminData } = require('./data');
const {
  parseProduct,
  parseCategory,
  parseWarning,
  parseIncidentStatus,
  parseTransactionStatus,
  parseWeather,
  trimText,
  trimMultiline,
} = require('./helpers');

const router = express.Router();
const WA_NUMBER = process.env.PUBLIC_WA_NUMBER || '6281200000000';
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const loginHits = new Map();
function loginLimiter(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const hits = (loginHits.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= 10) {
    return res.status(429).json({
      ok: false,
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Terlalu banyak percobaan masuk. Tunggu 15 menit lalu coba lagi.',
    });
  }
  hits.push(now);
  loginHits.set(key, hits);
  return next();
}

async function adminPayload(res, message) {
  const data = await getAdminData(WA_NUMBER);
  return res.json({ ok: true, message, data });
}

function validationError(res, parsed) {
  return res.status(400).json({
    ok: false,
    message: 'Periksa kembali data yang diisi.',
    errors: parsed.errors,
  });
}

// ---------------------------------------------------------------------------
// Autentikasi admin
// ---------------------------------------------------------------------------

router.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const username = trimText(req.body && req.body.username, 50);
    const password = String((req.body && req.body.password) || '');
    const errors = {};
    if (!username) errors.username = 'Username wajib diisi.';
    if (!password) errors.password = 'Password wajib diisi.';
    if (Object.keys(errors).length) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_LOGIN_INPUT',
        message: 'Periksa kembali data login.',
        errors,
      });
    }

    const [rows] = await pool.execute(
      'SELECT id, username, password_hash, full_name FROM admin_users WHERE username = ? LIMIT 1',
      [username],
    );
    const admin = rows[0];
    const valid = admin ? await bcrypt.compare(password, admin.password_hash) : false;
    if (!valid) {
      return res.status(401).json({
        ok: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Username atau password salah.',
      });
    }

    loginHits.delete(req.ip || req.socket.remoteAddress || 'unknown');
    const token = signToken(admin);
    return res.json({
      ok: true,
      message: 'Berhasil masuk sebagai admin.',
      token,
      admin: { id: admin.id, username: admin.username, name: admin.full_name },
    });
  }),
);

router.get(
  '/me',
  requireAdmin,
  wrap(async (req, res) => {
    const [rows] = await pool.execute(
      'SELECT id, username, full_name FROM admin_users WHERE id = ? LIMIT 1',
      [req.admin.sub],
    );
    if (!rows[0]) {
      return res.status(401).json({ ok: false, message: 'Akun admin tidak ditemukan.' });
    }
    return res.json({
      ok: true,
      admin: { id: rows[0].id, username: rows[0].username, name: rows[0].full_name },
    });
  }),
);

router.get(
  '/data',
  requireAdmin,
  wrap(async (req, res) => {
    const data = await getAdminData(WA_NUMBER);
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Cuaca - khusus admin
// ---------------------------------------------------------------------------

router.put(
  '/weather',
  requireAdmin,
  wrap(async (req, res) => {
    const parsed = parseWeather(req.body || {});
    if (!parsed.ok) return validationError(res, parsed);

    await withTransaction(async (conn) => {
      const dates = parsed.value.map((row) => row.date);
      const placeholders = dates.map(() => '?').join(', ');
      await conn.execute(
        `DELETE FROM weather_forecasts WHERE forecast_date NOT IN (${placeholders})`,
        dates,
      );
      for (const row of parsed.value) {
        await conn.execute(
          `INSERT INTO weather_forecasts
            (forecast_date, condition_text, temp_min, temp_max, rain_chance, alert_level, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             condition_text = VALUES(condition_text),
             temp_min = VALUES(temp_min),
             temp_max = VALUES(temp_max),
             rain_chance = VALUES(rain_chance),
             alert_level = VALUES(alert_level),
             updated_by = VALUES(updated_by)`,
          [row.date, row.condition, row.tempMin, row.tempMax, row.rainChance, row.alertLevel, req.admin.sub],
        );
      }
    });

    return adminPayload(res, 'Prakiraan cuaca berhasil disimpan ke MySQL.');
  }),
);

// ---------------------------------------------------------------------------
// Peringatan bencana - khusus admin
// ---------------------------------------------------------------------------

router.post(
  '/warnings',
  requireAdmin,
  wrap(async (req, res) => {
    const parsed = parseWarning(req.body || {});
    if (!parsed.ok) return validationError(res, parsed);
    const v = parsed.value;
    const [result] = await pool.execute(
      `INSERT INTO disaster_warnings
        (title, message, level, area, starts_at, ends_at, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.title, v.message, v.level, v.area, v.startsAt, v.endsAt, v.active ? 1 : 0, req.admin.sub],
    );
    const data = await getAdminData(WA_NUMBER);
    return res.status(201).json({
      ok: true,
      message: 'Peringatan bencana ditambahkan.',
      id: result.insertId,
      data,
    });
  }),
);

router.put(
  '/warnings/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID peringatan tidak valid.' });
    }
    const parsed = parseWarning(req.body || {});
    if (!parsed.ok) return validationError(res, parsed);
    const v = parsed.value;
    const [result] = await pool.execute(
      `UPDATE disaster_warnings
       SET title = ?, message = ?, level = ?, area = ?, starts_at = ?, ends_at = ?, is_active = ?
       WHERE id = ?`,
      [v.title, v.message, v.level, v.area, v.startsAt, v.endsAt, v.active ? 1 : 0, id],
    );
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Peringatan tidak ditemukan.' });
    }
    return adminPayload(res, 'Peringatan bencana diperbarui.');
  }),
);

router.delete(
  '/warnings/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID peringatan tidak valid.' });
    }
    const [result] = await pool.execute('DELETE FROM disaster_warnings WHERE id = ?', [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Peringatan tidak ditemukan.' });
    }
    return adminPayload(res, 'Peringatan bencana dihapus.');
  }),
);

// ---------------------------------------------------------------------------
// Kejadian informasi - moderasi admin
// ---------------------------------------------------------------------------

router.patch(
  '/incidents/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID kejadian tidak valid.' });
    }
    const status = parseIncidentStatus(req.body && req.body.status);
    if (!status) {
      return res.status(400).json({ ok: false, message: 'Status harus pending, published, atau rejected.' });
    }
    const hasNote = Object.prototype.hasOwnProperty.call(req.body || {}, 'adminNote');
    const [result] = hasNote
      ? await pool.execute(
        'UPDATE incidents SET status = ?, admin_note = ? WHERE id = ?',
        [status, trimMultiline(req.body.adminNote, 300), id],
      )
      : await pool.execute(
        'UPDATE incidents SET status = ? WHERE id = ?',
        [status, id],
      );
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Kejadian tidak ditemukan.' });
    }
    const label = status === 'published' ? 'dipublikasikan' : status === 'rejected' ? 'ditolak' : 'dikembalikan ke antrean';
    return adminPayload(res, `Kejadian ${label}.`);
  }),
);

router.delete(
  '/incidents/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID kejadian tidak valid.' });
    }
    const [result] = await pool.execute('DELETE FROM incidents WHERE id = ?', [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Kejadian tidak ditemukan.' });
    }
    return adminPayload(res, 'Kejadian dihapus.');
  }),
);

// ---------------------------------------------------------------------------
// Produk
// ---------------------------------------------------------------------------

router.post(
  '/products',
  requireAdmin,
  wrap(async (req, res) => {
    const parsed = parseProduct(req.body || {});
    if (!parsed.ok) return validationError(res, parsed);
    const v = parsed.value;
    const [catRows] = await pool.execute('SELECT id FROM categories WHERE id = ?', [v.categoryId]);
    if (!catRows[0]) {
      return res.status(400).json({ ok: false, message: 'Kategori tidak ditemukan.', errors: { categoryId: 'Pilih kategori yang tersedia.' } });
    }
    const id = `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 24);
    await pool.execute(
      `INSERT INTO products (id, name, category_id, price, stock, description, image_url, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, v.name, v.categoryId, v.price, v.stock, v.description, v.imageUrl, v.featured ? 1 : 0],
    );
    const data = await getAdminData(WA_NUMBER);
    return res.status(201).json({ ok: true, message: 'Produk ditambahkan.', id, data });
  }),
);

router.put(
  '/products/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[a-z0-9-]{3,24}$/i.test(id)) {
      return res.status(400).json({ ok: false, message: 'ID produk tidak valid.' });
    }
    const parsed = parseProduct(req.body || {});
    if (!parsed.ok) return validationError(res, parsed);
    const v = parsed.value;
    const [catRows] = await pool.execute('SELECT id FROM categories WHERE id = ?', [v.categoryId]);
    if (!catRows[0]) {
      return res.status(400).json({ ok: false, message: 'Kategori tidak ditemukan.', errors: { categoryId: 'Pilih kategori yang tersedia.' } });
    }
    const [result] = await pool.execute(
      `UPDATE products
       SET name = ?, category_id = ?, price = ?, stock = ?, description = ?, image_url = ?, featured = ?
       WHERE id = ?`,
      [v.name, v.categoryId, v.price, v.stock, v.description, v.imageUrl, v.featured ? 1 : 0, id],
    );
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Produk tidak ditemukan.' });
    }
    return adminPayload(res, 'Produk diperbarui.');
  }),
);

router.delete(
  '/products/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = String(req.params.id || '');
    let result;
    try {
      [result] = await pool.execute('DELETE FROM products WHERE id = ?', [id]);
    } catch (err) {
      if (err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({
          ok: false,
          message: 'Produk tidak dapat dihapus karena sudah dipakai pada transaksi. Nonaktifkan stoknya atau biarkan riwayat transaksi tetap utuh.',
        });
      }
      throw err;
    }
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Produk tidak ditemukan.' });
    }
    return adminPayload(res, 'Produk dihapus.');
  }),
);

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------

router.post(
  '/categories',
  requireAdmin,
  wrap(async (req, res) => {
    const parsed = parseCategory(req.body || {});
    if (!parsed.ok) return validationError(res, parsed);
    const v = parsed.value;
    const [[maxRow]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM categories');
    try {
      await pool.execute(
        'INSERT INTO categories (name, color, sort_order) VALUES (?, ?, ?)',
        [v.name, v.color, Number(maxRow.next_order)],
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, message: 'Kategori dengan nama itu sudah ada.', errors: { name: 'Nama kategori sudah dipakai.' } });
      }
      throw err;
    }
    return adminPayload(res, 'Kategori ditambahkan.');
  }),
);

router.put(
  '/categories/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID kategori tidak valid.' });
    }
    const parsed = parseCategory(req.body || {});
    if (!parsed.ok) return validationError(res, parsed);
    const v = parsed.value;
    try {
      const [result] = await pool.execute(
        'UPDATE categories SET name = ?, color = ? WHERE id = ?',
        [v.name, v.color, id],
      );
      if (!result.affectedRows) {
        return res.status(404).json({ ok: false, message: 'Kategori tidak ditemukan.' });
      }
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, message: 'Kategori dengan nama itu sudah ada.', errors: { name: 'Nama kategori sudah dipakai.' } });
      }
      throw err;
    }
    return adminPayload(res, 'Kategori diperbarui.');
  }),
);

router.delete(
  '/categories/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID kategori tidak valid.' });
    }
    const [[countRow]] = await pool.query('SELECT COUNT(*) AS n FROM categories');
    if (Number(countRow.n) <= 1) {
      return res.status(409).json({ ok: false, message: 'Minimal harus ada satu kategori.' });
    }
    const [[usedRow]] = await pool.execute(
      'SELECT COUNT(*) AS n FROM products WHERE category_id = ?',
      [id],
    );
    if (Number(usedRow.n) > 0) {
      return res.status(409).json({
        ok: false,
        message: `Kategori masih dipakai oleh ${usedRow.n} produk. Pindahkan atau hapus produknya lebih dulu.`,
      });
    }
    const [result] = await pool.execute('DELETE FROM categories WHERE id = ?', [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ ok: false, message: 'Kategori tidak ditemukan.' });
    }
    return adminPayload(res, 'Kategori dihapus.');
  }),
);

// ---------------------------------------------------------------------------
// Transaksi pembayaran manual - verifikasi admin
// ---------------------------------------------------------------------------

router.patch(
  '/transactions/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID transaksi tidak valid.' });
    }
    const status = parseTransactionStatus(req.body && req.body.status);
    if (!status) {
      return res.status(400).json({ ok: false, message: 'Status harus verified atau cancelled.' });
    }
    const hasNote = Object.prototype.hasOwnProperty.call(req.body || {}, 'adminNote');
    const adminNote = hasNote ? trimMultiline(req.body.adminNote, 300) : null;
    let message = '';

    try {
      await withTransaction(async (conn) => {
        const [txRows] = await conn.execute(
          'SELECT id, status, stock_applied AS stockApplied FROM transactions WHERE id = ? FOR UPDATE',
          [id],
        );
        const tx = txRows[0];
        if (!tx) {
          const err = new Error('Transaksi tidak ditemukan.');
          err.status = 404;
          throw err;
        }
        const [items] = await conn.execute(
          'SELECT product_id AS productId, product_name AS name, quantity FROM transaction_items WHERE transaction_id = ?',
          [id],
        );

        if (status === 'verified') {
          if (tx.status === 'verified') {
            message = 'Transaksi sudah terverifikasi.';
            return;
          }
          if (tx.status === 'cancelled') {
            const err = new Error('Transaksi yang sudah dibatalkan tidak dapat diverifikasi. Buat pesanan baru.');
            err.status = 409;
            err.code = 'TRANSACTION_CANCELLED';
            throw err;
          }
          for (const item of items) {
            const [update] = await conn.execute(
              'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
              [item.quantity, item.productId, item.quantity],
            );
            if (!update.affectedRows) {
              const err = new Error(`Stok ${item.name} tidak mencukupi untuk verifikasi. Perbarui stok lalu coba lagi.`);
              err.status = 409;
              err.code = 'OUT_OF_STOCK';
              throw err;
            }
          }
          await conn.execute(
            `UPDATE transactions
             SET status = 'verified', stock_applied = 1,
                 admin_note = COALESCE(?, admin_note), verified_by = ?,
                 verified_at = NOW(), cancelled_at = NULL
             WHERE id = ?`,
            [adminNote, req.admin.sub, id],
          );
          message = 'Pembayaran diverifikasi dan stok produk dikurangi.';
          return;
        }

        if (tx.status === 'cancelled') {
          message = 'Transaksi sudah dibatalkan.';
          return;
        }
        if (Number(tx.stockApplied)) {
          for (const item of items) {
            await conn.execute(
              'UPDATE products SET stock = stock + ? WHERE id = ?',
              [item.quantity, item.productId],
            );
          }
        }
        await conn.execute(
          `UPDATE transactions
           SET status = 'cancelled', stock_applied = 0,
               admin_note = COALESCE(?, admin_note), verified_by = ?,
               cancelled_at = NOW()
           WHERE id = ?`,
          [adminNote, req.admin.sub, id],
        );
        message = Number(tx.stockApplied)
          ? 'Transaksi dibatalkan dan stok produk dikembalikan.'
          : 'Transaksi dibatalkan.';
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ ok: false, code: err.code, message: err.message });
      }
      throw err;
    }

    return adminPayload(res, message);
  }),
);

router.delete(
  '/transactions/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: 'ID transaksi tidak valid.' });
    }

    try {
      await withTransaction(async (conn) => {
        const [txRows] = await conn.execute(
          'SELECT id, stock_applied AS stockApplied FROM transactions WHERE id = ? FOR UPDATE',
          [id],
        );
        const tx = txRows[0];
        if (!tx) {
          const err = new Error('Transaksi tidak ditemukan.');
          err.status = 404;
          throw err;
        }
        if (Number(tx.stockApplied)) {
          const [items] = await conn.execute(
            'SELECT product_id AS productId, quantity FROM transaction_items WHERE transaction_id = ?',
            [id],
          );
          for (const item of items) {
            await conn.execute(
              'UPDATE products SET stock = stock + ? WHERE id = ?',
              [item.quantity, item.productId],
            );
          }
        }
        await conn.execute('DELETE FROM transactions WHERE id = ?', [id]);
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ ok: false, code: err.code, message: err.message });
      }
      throw err;
    }

    return adminPayload(res, 'Transaksi dihapus. Stok yang pernah dikurangi sudah dikembalikan.');
  }),
);

module.exports = router;
