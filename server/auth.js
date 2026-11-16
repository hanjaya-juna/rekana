'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'rekana-development-secret-change-me';
const EXPIRES = process.env.JWT_EXPIRES || '8h';

if (!process.env.JWT_SECRET) {
  console.warn('[peringatan] JWT_SECRET belum diisi di .env. Memakai rahasia pengembangan.');
}

function signToken(admin) {
  return jwt.sign(
    {
      sub: String(admin.id),
      username: admin.username,
      role: 'admin',
    },
    SECRET,
    {
      expiresIn: EXPIRES,
      issuer: 'rekana',
      audience: 'rekana-admin',
    },
  );
}

function readToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function requireAdmin(req, res, next) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, message: 'Sesi admin tidak ditemukan. Silakan masuk kembali.' });
  }
  try {
    const payload = jwt.verify(token, SECRET, { issuer: 'rekana', audience: 'rekana-admin' });
    if (payload.role !== 'admin') throw new Error('Bukan admin');
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: 'Sesi admin sudah tidak berlaku. Silakan masuk kembali.' });
  }
}

module.exports = { signToken, requireAdmin };
