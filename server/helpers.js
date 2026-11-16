'use strict';

const { isPaymentMethod } = require('./payment');

const LEVELS = ['Normal', 'Waspada', 'Siaga'];
const WARNING_LEVELS = ['Waspada', 'Siaga', 'Awas'];
const INCIDENT_STATUSES = ['pending', 'published', 'rejected'];
const TRANSACTION_STATUSES = ['verified', 'cancelled'];
const DELIVERY_METHODS = ['pickup', 'delivery'];

function trimText(value, maxLength) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function trimMultiline(value, maxLength) {
  const text = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function nowMysql() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseLocalDateTime(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const hour = Number(hh);
  const minute = Number(mm);
  const second = Number(ss);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function isValidDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
  return date.getFullYear() === Number(y) && date.getMonth() === Number(m) - 1 && date.getDate() === Number(d);
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function parseIntInRange(value, min, max) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function parseProduct(body) {
  const errors = {};
  const name = trimText(body.name, 60);
  if (name.length < 2 || name.length > 60) errors.name = 'Nama produk harus 2 sampai 60 karakter.';

  const categoryId = Number(body.categoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) errors.categoryId = 'Pilih kategori produk.';

  const price = Number(body.price);
  if (!Number.isInteger(price) || price < 0 || price > 1_000_000_000) {
    errors.price = 'Harga harus bilangan bulat 0 atau lebih.';
  }

  const stock = Number(body.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
    errors.stock = 'Stok harus bilangan bulat 0 atau lebih.';
  }

  const description = trimMultiline(body.description, 300);
  if (description.length > 300) errors.description = 'Deskripsi maksimal 300 karakter.';

  const imageUrl = trimText(body.imageUrl, 255);
  if (imageUrl && !/^(https?:\/\/|assets\/|\/(?!\/))/i.test(imageUrl)) {
    errors.imageUrl = 'Alamat gambar harus diawali https://, assets/, atau /.';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      name,
      categoryId,
      price,
      stock,
      description,
      imageUrl,
      featured: parseBoolean(body.featured, false),
    },
  };
}

function parseCategory(body) {
  const errors = {};
  const name = trimText(body.name, 50);
  if (name.length < 2 || name.length > 50) errors.name = 'Nama kategori harus 2 sampai 50 karakter.';
  let color = trimText(body.color, 7) || '#22385a';
  if (!/^#[0-9a-f]{6}$/i.test(color)) errors.color = 'Warna harus format #RRGGBB.';
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { name, color },
  };
}

function parseWarning(body) {
  const errors = {};
  const title = trimText(body.title, 120);
  if (title.length < 3 || title.length > 120) errors.title = 'Judul peringatan harus 3 sampai 120 karakter.';

  const message = trimMultiline(body.message, 500);
  if (message.length < 5 || message.length > 500) errors.message = 'Isi peringatan harus 5 sampai 500 karakter.';

  const level = trimText(body.level, 20) || 'Waspada';
  if (!WARNING_LEVELS.includes(level)) errors.level = 'Level harus Waspada, Siaga, atau Awas.';

  const area = trimText(body.area, 100);
  if (area.length < 2 || area.length > 100) errors.area = 'Wilayah harus 2 sampai 100 karakter.';

  const startsAt = parseLocalDateTime(body.startsAt);
  if (!startsAt) errors.startsAt = 'Waktu mulai wajib diisi dengan format tanggal dan jam yang benar.';

  let endsAt = null;
  if (body.endsAt) {
    endsAt = parseLocalDateTime(body.endsAt);
    if (!endsAt) errors.endsAt = 'Waktu selesai tidak valid.';
    else if (startsAt && endsAt <= startsAt) errors.endsAt = 'Waktu selesai harus setelah waktu mulai.';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      title,
      message,
      level,
      area,
      startsAt,
      endsAt,
      active: parseBoolean(body.active, true),
    },
  };
}

function parseIncident(body) {
  const errors = {};
  const title = trimText(body.title, 120);
  if (title.length < 3 || title.length > 120) errors.title = 'Judul kejadian harus 3 sampai 120 karakter.';

  const summary = trimMultiline(body.summary, 600);
  if (summary.length < 5 || summary.length > 600) errors.summary = 'Ringkasan harus 5 sampai 600 karakter.';

  const type = trimText(body.type, 50);
  if (type.length < 2 || type.length > 50) errors.type = 'Jenis kejadian harus 2 sampai 50 karakter.';

  const location = trimText(body.location, 120);
  if (location.length < 2 || location.length > 120) errors.location = 'Lokasi harus 2 sampai 120 karakter.';

  let occurredAt = nowMysql();
  if (body.occurredAt) {
    occurredAt = parseLocalDateTime(body.occurredAt);
    if (!occurredAt) errors.occurredAt = 'Waktu kejadian tidak valid.';
  }

  const rawLat = body.lat === '' || body.lat === null || body.lat === undefined ? null : Number(body.lat);
  const rawLng = body.lng === '' || body.lng === null || body.lng === undefined ? null : Number(body.lng);
  if ((rawLat === null) !== (rawLng === null)) {
    errors.lat = 'Latitude dan longitude harus diisi berpasangan.';
    errors.lng = 'Latitude dan longitude harus diisi berpasangan.';
  } else if (rawLat !== null) {
    if (!Number.isFinite(rawLat) || rawLat < -90 || rawLat > 90) errors.lat = 'Latitude harus antara -90 dan 90.';
    if (!Number.isFinite(rawLng) || rawLng < -180 || rawLng > 180) errors.lng = 'Longitude harus antara -180 dan 180.';
  }

  const reporterName = trimText(body.reporterName, 80);
  const reporterContact = trimText(body.reporterContact, 80);
  if (String(body.reporterContact || '').length > 80) errors.reporterContact = 'Kontak maksimal 80 karakter.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      title,
      summary,
      type,
      location,
      lat: rawLat,
      lng: rawLng,
      occurredAt,
      reporterName,
      reporterContact,
    },
  };
}

function parseWeather(body) {
  const errors = {};
  const records = Array.isArray(body.forecasts) ? body.forecasts : Array.isArray(body) ? body : null;
  if (!records) return { ok: false, errors: { forecasts: 'Data prakiraan tidak ditemukan.' }, value: [] };
  if (records.length < 1 || records.length > 14) {
    return { ok: false, errors: { forecasts: 'Jumlah baris prakiraan harus 1 sampai 14.' }, value: [] };
  }

  const dates = new Set();
  const value = [];
  records.forEach((row, index) => {
    const prefix = `forecasts.${index}`;
    const date = trimText(row.date, 10);
    if (!isValidDateOnly(date)) errors[`${prefix}.date`] = 'Tanggal tidak valid.';
    else if (dates.has(date)) errors[`${prefix}.date`] = 'Tanggal duplikat.';
    dates.add(date);

    const condition = trimText(row.condition, 50);
    if (condition.length < 2) errors[`${prefix}.condition`] = 'Kondisi cuaca wajib diisi.';

    const tempMin = parseIntInRange(row.tempMin, -20, 60);
    const tempMax = parseIntInRange(row.tempMax, -20, 60);
    if (tempMin === null) errors[`${prefix}.tempMin`] = 'Suhu minimum harus -20 sampai 60.';
    if (tempMax === null) errors[`${prefix}.tempMax`] = 'Suhu maksimum harus -20 sampai 60.';
    if (tempMin !== null && tempMax !== null && tempMin > tempMax) {
      errors[`${prefix}.tempMin`] = 'Suhu minimum tidak boleh lebih besar dari maksimum.';
    }

    const rainChance = parseIntInRange(row.rainChance, 0, 100);
    if (rainChance === null) errors[`${prefix}.rainChance`] = 'Peluang hujan harus 0 sampai 100.';

    const alertLevel = trimText(row.alertLevel, 20) || 'Normal';
    if (!LEVELS.includes(alertLevel)) errors[`${prefix}.alertLevel`] = 'Level kewaspadaan tidak valid.';

    value.push({ date, condition, tempMin, tempMax, rainChance, alertLevel });
  });

  return { ok: Object.keys(errors).length === 0, errors, value };
}

function parseIncidentStatus(value) {
  const status = trimText(value, 20);
  if (!INCIDENT_STATUSES.includes(status)) return null;
  return status;
}

function normalizeContact(value) {
  const text = trimText(value, 80).toLowerCase();
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 5 && /^[+()\d\s.-]+$/.test(text)) return digits;
  return text;
}

function isValidContact(value) {
  const text = trimText(value, 80);
  if (text.length < 5) return false;
  const isPhone = /^[+()\d\s.-]{7,20}$/.test(text);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text);
  return isPhone || isEmail;
}

function parseCheckout(body) {
  const errors = {};

  const customerName = trimText(body.customerName, 80);
  if (customerName.length < 2) errors.customerName = 'Nama pemesan minimal 2 karakter.';

  const customerContact = trimText(body.customerContact, 80);
  if (!isValidContact(customerContact)) {
    errors.customerContact = 'Isi nomor WhatsApp atau alamat email yang valid.';
  }

  const deliveryMethod = trimText(body.deliveryMethod, 20) || 'pickup';
  if (!DELIVERY_METHODS.includes(deliveryMethod)) {
    errors.deliveryMethod = 'Pilih cara menerima pesanan.';
  }

  const address = trimMultiline(body.address, 200);
  if (deliveryMethod === 'delivery' && address.length < 5) {
    errors.address = 'Alamat pengantaran wajib diisi minimal 5 karakter.';
  }

  const note = trimMultiline(body.note, 300);
  const paymentMethod = trimText(body.paymentMethod, 20);
  if (!isPaymentMethod(paymentMethod)) {
    errors.paymentMethod = 'Pilih metode pembayaran yang tersedia.';
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const merged = new Map();
  if (rawItems.length < 1 || rawItems.length > 20) {
    errors.items = 'Pesanan harus berisi 1 sampai 20 jenis produk.';
  } else {
    rawItems.forEach((item) => {
      const id = trimText(item && item.id, 24);
      const quantity = Number(item && item.quantity);
      if (!/^[a-z0-9-]{3,24}$/i.test(id)) {
        errors.items = 'Ada produk yang tidak valid pada pesanan.';
        return;
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        errors.items = 'Jumlah setiap produk harus 1 sampai 99.';
        return;
      }
      merged.set(id, (merged.get(id) || 0) + quantity);
    });
    if (merged.size > 20) errors.items = 'Maksimal 20 jenis produk per pesanan.';
    for (const quantity of merged.values()) {
      if (quantity > 99) errors.items = 'Jumlah setiap produk maksimal 99.';
    }
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      customerName,
      customerContact,
      deliveryMethod,
      address,
      note,
      paymentMethod,
      items: Array.from(merged, ([id, quantity]) => ({ id, quantity })),
    },
  };
}

function parseTransactionStatus(value) {
  const status = trimText(value, 20);
  if (!TRANSACTION_STATUSES.includes(status)) return null;
  return status;
}

module.exports = {
  LEVELS,
  WARNING_LEVELS,
  INCIDENT_STATUSES,
  TRANSACTION_STATUSES,
  DELIVERY_METHODS,
  trimText,
  trimMultiline,
  nowMysql,
  parseLocalDateTime,
  parseProduct,
  parseCategory,
  parseWarning,
  parseIncident,
  parseWeather,
  parseIncidentStatus,
  normalizeContact,
  isValidContact,
  parseCheckout,
  parseTransactionStatus,
};
