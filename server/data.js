'use strict';

const { pool } = require('./db');
const { PAYMENT_INFO, paymentMethodInfo } = require('./payment');

function todayDateOnly() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    category: row.category,
    categoryColor: row.category_color,
    price: Number(row.price),
    stock: Number(row.stock),
    description: row.description || '',
    imageUrl: row.image_url || '',
    featured: Boolean(row.featured),
  };
}

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: Number(row.sort_order),
    productCount: Number(row.product_count || 0),
  };
}

function mapWeather(row) {
  return {
    id: row.id,
    date: row.date,
    condition: row.condition,
    tempMin: Number(row.tempMin),
    tempMax: Number(row.tempMax),
    rainChance: Number(row.rainChance),
    alertLevel: row.alertLevel,
    updatedAt: row.updatedAt,
  };
}

function mapWarning(row, includeMeta = false) {
  const warning = {
    id: row.id,
    title: row.title,
    message: row.message,
    level: row.level,
    area: row.area,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: Boolean(row.active),
  };
  if (includeMeta) {
    warning.createdBy = row.createdBy || null;
    warning.createdAt = row.createdAt;
    warning.updatedAt = row.updatedAt;
  }
  return warning;
}

function mapIncident(row, includeReporter = false) {
  const incident = {
    id: row.id,
    title: row.title,
    summary: row.summary,
    type: row.type,
    location: row.location,
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
    occurredAt: row.occurredAt,
    status: row.status,
    createdAt: row.createdAt,
    adminNote: row.adminNote || '',
  };
  if (includeReporter) {
    incident.reporterName = row.reporterName || '';
    incident.reporterContact = row.reporterContact || '';
  }
  return incident;
}

function mapTransactionItem(row) {
  return {
    productId: row.productId,
    name: row.name,
    price: Number(row.price),
    quantity: Number(row.quantity),
    subtotal: Number(row.subtotal),
  };
}

function mapTransaction(row, items = [], includeCustomer = false) {
  const method = paymentMethodInfo(row.paymentMethod || row.payment_method);
  const transaction = {
    id: row.id,
    code: row.code,
    status: row.status,
    paymentMethod: row.paymentMethod || row.payment_method,
    paymentLabel: method ? method.label : 'Pembayaran manual',
    total: Number(row.total),
    itemCount: Number(row.itemCount || row.item_count || 0),
    deliveryMethod: row.deliveryMethod || row.delivery_method,
    createdAt: row.createdAt || row.created_at,
    verifiedAt: row.verifiedAt || null,
    cancelledAt: row.cancelledAt || null,
    items: items.map(mapTransactionItem),
  };
  if (includeCustomer) {
    transaction.customerName = row.customerName || row.customer_name || '';
    transaction.customerContact = row.customerContact || row.customer_contact || '';
    transaction.address = row.address || '';
    transaction.note = row.note || '';
    transaction.adminNote = row.adminNote || row.admin_note || '';
    transaction.stockApplied = Boolean(row.stockApplied || row.stock_applied);
  }
  return transaction;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.category_id, c.name AS category, c.color AS category_color,
         p.price, p.stock, p.description, p.image_url, p.featured
  FROM products p
  JOIN categories c ON c.id = p.category_id
  ORDER BY p.featured DESC, p.name ASC`;

const CATEGORY_SELECT = `
  SELECT c.id, c.name, c.color, c.sort_order, COUNT(p.id) AS product_count
  FROM categories c
  LEFT JOIN products p ON p.category_id = c.id
  GROUP BY c.id, c.name, c.color, c.sort_order
  ORDER BY c.sort_order ASC, c.name ASC`;

const WEATHER_SELECT = `
  SELECT id, forecast_date AS \`date\`, condition_text AS \`condition\`,
         temp_min AS tempMin, temp_max AS tempMax, rain_chance AS rainChance,
         alert_level AS alertLevel, updated_at AS updatedAt
  FROM weather_forecasts
  ORDER BY forecast_date ASC`;

const PUBLIC_WARNING_SELECT = `
  SELECT id, title, message, level, area, starts_at AS startsAt, ends_at AS endsAt,
         is_active AS active
  FROM disaster_warnings
  WHERE is_active = 1
    AND starts_at <= NOW()
    AND (ends_at IS NULL OR ends_at >= NOW())
  ORDER BY FIELD(level, 'Awas', 'Siaga', 'Waspada'), starts_at DESC`;

const ADMIN_WARNING_SELECT = `
  SELECT id, title, message, level, area, starts_at AS startsAt, ends_at AS endsAt,
         is_active AS active, created_by AS createdBy, created_at AS createdAt,
         updated_at AS updatedAt
  FROM disaster_warnings
  ORDER BY is_active DESC, FIELD(level, 'Awas', 'Siaga', 'Waspada'), starts_at DESC`;

const PUBLIC_INCIDENT_SELECT = `
  SELECT id, title, summary, type, location, lat, lng, occurred_at AS occurredAt,
         status, admin_note AS adminNote, created_at AS createdAt
  FROM incidents
  WHERE status = 'published'
  ORDER BY occurred_at DESC, id DESC
  LIMIT 100`;

const ADMIN_INCIDENT_SELECT = `
  SELECT id, title, summary, type, location, lat, lng, occurred_at AS occurredAt,
         status, admin_note AS adminNote, created_at AS createdAt,
         reporter_name AS reporterName, reporter_contact AS reporterContact
  FROM incidents
  ORDER BY FIELD(status, 'pending', 'published', 'rejected'), occurred_at DESC, id DESC
  LIMIT 300`;

const ADMIN_TRANSACTION_SELECT = `
  SELECT id, code, customer_name AS customerName, customer_contact AS customerContact,
         delivery_method AS deliveryMethod, address, note, payment_method AS paymentMethod,
         total, item_count AS itemCount, status, stock_applied AS stockApplied,
         admin_note AS adminNote, created_at AS createdAt, verified_at AS verifiedAt,
         cancelled_at AS cancelledAt
  FROM transactions
  ORDER BY FIELD(status, 'pending', 'verified', 'cancelled'), created_at DESC, id DESC
  LIMIT 200`;

async function getPublicBootstrap(waNumber) {
  const [productRows, categoryRows, weatherRows, warningRows, incidentRows] = await Promise.all([
    pool.query(PRODUCT_SELECT),
    pool.query(CATEGORY_SELECT),
    pool.query(WEATHER_SELECT),
    pool.query(PUBLIC_WARNING_SELECT),
    pool.query(PUBLIC_INCIDENT_SELECT),
  ]);

  const products = productRows[0].map(mapProduct);
  const categories = categoryRows[0].map(mapCategory);
  const weather = weatherRows[0].map(mapWeather);
  const warnings = warningRows[0].map((row) => mapWarning(row));
  const incidents = incidentRows[0].map((row) => mapIncident(row, false));
  const today = todayDateOnly();

  return {
    serverTime: new Date().toISOString(),
    today,
    waNumber: waNumber || '6281200000000',
    payment: PAYMENT_INFO,
    categories,
    products,
    weather,
    warnings,
    incidents,
    stats: {
      totalProducts: products.length,
      totalStock: products.reduce((sum, p) => sum + p.stock, 0),
      featuredProducts: products.filter((p) => p.featured).length,
      lowStockProducts: products.filter((p) => p.stock <= 5).length,
      publishedIncidents: incidents.length,
      incidentsToday: incidents.filter((i) => i.occurredAt.slice(0, 10) === today).length,
      activeWarnings: warnings.length,
    },
  };
}

async function getAdminData(waNumber) {
  const base = await getPublicBootstrap(waNumber);
  const [warningRows, incidentRows, productRows, categoryRows, transactionRows] = await Promise.all([
    pool.query(ADMIN_WARNING_SELECT),
    pool.query(ADMIN_INCIDENT_SELECT),
    pool.query(PRODUCT_SELECT),
    pool.query(CATEGORY_SELECT),
    pool.query(ADMIN_TRANSACTION_SELECT),
  ]);

  const allWarnings = warningRows[0].map((row) => mapWarning(row, true));
  const allIncidents = incidentRows[0].map((row) => mapIncident(row, true));
  const products = productRows[0].map(mapProduct);
  const categories = categoryRows[0].map(mapCategory);

  const transactionIds = transactionRows[0].map((row) => Number(row.id));
  const itemsByTransaction = new Map();
  if (transactionIds.length) {
    const placeholders = transactionIds.map(() => '?').join(', ');
    const [itemRows] = await pool.query(
      `SELECT transaction_id AS txId, product_id AS productId, product_name AS name,
              unit_price AS price, quantity, subtotal
       FROM transaction_items
       WHERE transaction_id IN (${placeholders})
       ORDER BY id ASC`,
      transactionIds,
    );
    itemRows.forEach((row) => {
      const key = Number(row.txId);
      if (!itemsByTransaction.has(key)) itemsByTransaction.set(key, []);
      itemsByTransaction.get(key).push(row);
    });
  }
  const transactions = transactionRows[0].map((row) => (
    mapTransaction(row, itemsByTransaction.get(Number(row.id)) || [], true)
  ));

  const today = todayDateOnly();
  const todayWeather = base.weather.find((w) => w.date === today) || base.weather[0] || null;

  return {
    ...base,
    products,
    categories,
    warnings: base.warnings,
    allWarnings,
    incidents: base.incidents,
    allIncidents,
    transactions,
    summary: {
      totalProducts: products.length,
      totalStock: products.reduce((sum, p) => sum + p.stock, 0),
      featuredProducts: products.filter((p) => p.featured).length,
      lowStockProducts: products.filter((p) => p.stock <= 5).length,
      pendingIncidents: allIncidents.filter((i) => i.status === 'pending').length,
      publishedIncidents: allIncidents.filter((i) => i.status === 'published').length,
      rejectedIncidents: allIncidents.filter((i) => i.status === 'rejected').length,
      incidentsToday: allIncidents.filter((i) => i.occurredAt.slice(0, 10) === today).length,
      activeWarnings: allWarnings.filter((w) => w.active).length,
      pendingTransactions: transactions.filter((t) => t.status === 'pending').length,
      verifiedTransactions: transactions.filter((t) => t.status === 'verified').length,
      cancelledTransactions: transactions.filter((t) => t.status === 'cancelled').length,
      verifiedRevenue: transactions
        .filter((t) => t.status === 'verified')
        .reduce((sum, t) => sum + t.total, 0),
      categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color, count: c.productCount })),
      todayWeather,
    },
  };
}

module.exports = {
  getPublicBootstrap,
  getAdminData,
  mapProduct,
  mapCategory,
  mapWeather,
  mapWarning,
  mapIncident,
  mapTransaction,
  mapTransactionItem,
  todayDateOnly,
};
