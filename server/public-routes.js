'use strict';

const crypto = require('crypto');
const express = require('express');
const { pool, withTransaction } = require('./db');
const { getPublicBootstrap, mapTransaction } = require('./data');
const { parseIncident, parseCheckout, normalizeContact, trimText } = require('./helpers');
const {
  PAYMENT_INFO,
  buildPaymentInstructions,
  paymentMethodInfo,
} = require('./payment');

const router = express.Router();
const WA_NUMBER = process.env.PUBLIC_WA_NUMBER || '6281200000000';

const pad = (n) => String(n).padStart(2, '0');

function makeLimiter({ max, windowMs, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      return res.status(429).json({ ok: false, message });
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 500) {
      for (const [k, values] of hits) {
        if (!values.some((t) => now - t < windowMs)) hits.delete(k);
      }
    }
    return next();
  };
}

// Pembatas sederhana: maksimal 8 laporan per IP dalam 10 menit.
const reportLimiter = makeLimiter({
  max: 8,
  windowMs: 10 * 60 * 1000,
  message: 'Terlalu banyak laporan dari perangkat ini. Coba lagi beberapa menit lagi.',
});

// Maksimal 6 pesanan baru per IP dalam 10 menit.
const checkoutLimiter = makeLimiter({
  max: 6,
  windowMs: 10 * 60 * 1000,
  message: 'Terlalu banyak pesanan dari perangkat ini. Tunggu beberapa menit lalu coba lagi.',
});

// Maksimal 20 pengecekan status per IP dalam 10 menit.
const lookupLimiter = makeLimiter({
  max: 20,
  windowMs: 10 * 60 * 1000,
  message: 'Terlalu banyak pengecekan status. Tunggu beberapa menit lalu coba lagi.',
});

function makeOrderCode() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `RKN-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const TRANSACTION_BY_ID_SELECT = `
  SELECT id, code, customer_name AS customerName, customer_contact AS customerContact,
         delivery_method AS deliveryMethod, address, note, payment_method AS paymentMethod,
         total, item_count AS itemCount, status, stock_applied AS stockApplied,
         admin_note AS adminNote, created_at AS createdAt, verified_at AS verifiedAt,
         cancelled_at AS cancelledAt
  FROM transactions
  WHERE id = ?`;

const TRANSACTION_ITEMS_SELECT = `
  SELECT product_id AS productId, product_name AS name, unit_price AS price,
         quantity, subtotal
  FROM transaction_items
  WHERE transaction_id = ?
  ORDER BY id ASC`;

function paymentPayload(methodId, transaction) {
  const method = paymentMethodInfo(methodId);
  return {
    method,
    instructions: buildPaymentInstructions(methodId, {
      code: transaction.code,
      total: transaction.total,
    }),
    note: PAYMENT_INFO.note,
  };
}

async function readTransaction(id) {
  const [rows] = await pool.execute(TRANSACTION_BY_ID_SELECT, [id]);
  if (!rows[0]) return null;
  const [items] = await pool.execute(TRANSACTION_ITEMS_SELECT, [id]);
  return mapTransaction(rows[0], items, true);
}

router.get('/bootstrap', async (req, res, next) => {
  try {
    const data = await getPublicBootstrap(WA_NUMBER);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

router.post('/incidents', reportLimiter, async (req, res) => {
  const parsed = parseIncident(req.body || {});
  if (!parsed.ok) {
    return res.status(400).json({
      ok: false,
      message: 'Periksa kembali isi laporan.',
      errors: parsed.errors,
    });
  }

  const v = parsed.value;
  try {
    const [result] = await pool.execute(
      `INSERT INTO incidents
        (title, summary, type, location, lat, lng, occurred_at, status, reporter_name, reporter_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        v.title,
        v.summary,
        v.type,
        v.location,
        v.lat,
        v.lng,
        v.occurredAt,
        v.reporterName,
        v.reporterContact,
      ],
    );
    res.status(201).json({
      ok: true,
      id: result.insertId,
      status: 'pending',
      message: 'Laporan diterima dan menunggu pemeriksaan admin. Terima kasih.',
    });
  } catch (err) {
    console.error('Gagal menyimpan laporan kejadian:', err.message);
    res.status(503).json({
      ok: false,
      message: 'Laporan belum dapat disimpan ke server. Data akan dicoba lagi saat koneksi tersedia.',
      offline: true,
    });
  }
});

router.post('/transactions', checkoutLimiter, async (req, res, next) => {
  const parsed = parseCheckout(req.body || {});
  if (!parsed.ok) {
    return res.status(400).json({
      ok: false,
      message: 'Periksa kembali data pesanan.',
      errors: parsed.errors,
    });
  }

  const v = parsed.value;
  try {
    const ids = v.items.map((item) => item.id);
    const placeholders = ids.map(() => '?').join(', ');
    const [productRows] = await pool.query(
      `SELECT id, name, price, stock FROM products WHERE id IN (${placeholders})`,
      ids,
    );
    const products = new Map(productRows.map((row) => [row.id, row]));

    const missing = v.items.filter((item) => !products.has(item.id));
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        code: 'PRODUCT_NOT_FOUND',
        message: 'Ada produk yang sudah tidak tersedia. Muat ulang katalog lalu coba lagi.',
        errors: { items: 'Produk pada keranjang sudah tidak tersedia.' },
      });
    }

    const lines = v.items.map((item) => {
      const product = products.get(item.id);
      return {
        productId: product.id,
        name: product.name,
        price: Number(product.price),
        stock: Number(product.stock),
        quantity: item.quantity,
        subtotal: Number(product.price) * item.quantity,
      };
    });

    const insufficient = lines.find((line) => line.quantity > line.stock);
    if (insufficient) {
      return res.status(409).json({
        ok: false,
        code: 'OUT_OF_STOCK',
        message: insufficient.stock <= 0
          ? `Stok ${insufficient.name} sedang habis.`
          : `Stok ${insufficient.name} tersisa ${insufficient.stock}. Kurangi jumlah pesanan.`,
        errors: { items: 'Jumlah pesanan melebihi stok yang tersedia.' },
      });
    }

    const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

    let insertedId = 0;
    let orderCode = '';
    await withTransaction(async (conn) => {
      for (let attempt = 0; attempt < 6 && !insertedId; attempt += 1) {
        orderCode = makeOrderCode();
        try {
          const [result] = await conn.execute(
            `INSERT INTO transactions
              (code, customer_name, customer_contact, delivery_method, address, note,
               payment_method, total, item_count, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
              orderCode,
              v.customerName,
              v.customerContact,
              v.deliveryMethod,
              v.address,
              v.note,
              v.paymentMethod,
              total,
              itemCount,
            ],
          );
          insertedId = result.insertId;
        } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY') throw err;
        }
      }
      if (!insertedId) {
        const err = new Error('Kode pesanan gagal dibuat. Coba lagi.');
        err.status = 503;
        throw err;
      }
      for (const line of lines) {
        await conn.execute(
          `INSERT INTO transaction_items
            (transaction_id, product_id, product_name, unit_price, quantity, subtotal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [insertedId, line.productId, line.name, line.price, line.quantity, line.subtotal],
        );
      }
    });

    const transaction = await readTransaction(insertedId);
    return res.status(201).json({
      ok: true,
      message: `Pesanan ${transaction.code} dibuat. Simpan kode ini untuk mengecek status.`,
      transaction,
      payment: paymentPayload(v.paymentMethod, transaction),
    });
  } catch (err) {
    if (err.status === 503) {
      return res.status(503).json({ ok: false, code: 'ORDER_CODE_FAILED', message: err.message });
    }
    next(err);
  }
});

router.post('/transactions/lookup', lookupLimiter, async (req, res, next) => {
  const code = trimText(req.body && req.body.code, 20).toUpperCase();
  const contact = trimText(req.body && req.body.contact, 80);
  const errors = {};
  if (!code) errors.code = 'Kode pesanan wajib diisi.';
  if (!contact) errors.contact = 'Kontak pemesan wajib diisi.';
  if (Object.keys(errors).length) {
    return res.status(400).json({
      ok: false,
      message: 'Isi kode pesanan dan kontak pemesan.',
      errors,
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id
       FROM transactions
       WHERE code = ?
       LIMIT 1`,
      [code],
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({
        ok: false,
        code: 'ORDER_NOT_FOUND',
        message: 'Pesanan tidak ditemukan. Periksa kembali kode dan kontak yang dipakai.',
      });
    }

    const transaction = await readTransaction(row.id);
    if (!transaction || normalizeContact(transaction.customerContact) !== normalizeContact(contact)) {
      return res.status(404).json({
        ok: false,
        code: 'ORDER_NOT_FOUND',
        message: 'Pesanan tidak ditemukan. Periksa kembali kode dan kontak yang dipakai.',
      });
    }

    return res.json({
      ok: true,
      transaction,
      payment: paymentPayload(transaction.paymentMethod, transaction),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
