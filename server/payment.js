'use strict';

// Informasi pembayaran manual. Tidak ada payment gateway dan tidak ada API key.
// Nilai dapat diubah lewat .env tanpa mengubah kode.

const PAYMENT_METHODS = [
  {
    id: 'transfer',
    label: 'Transfer Bank',
    short: 'Transfer',
    description: 'Transfer ke rekening REKANA, lalu kirim bukti melalui WhatsApp.',
  },
  {
    id: 'qris',
    label: 'QRIS',
    short: 'QRIS',
    description: 'Pindai kode QRIS dari aplikasi pembayaran, lalu kirim bukti melalui WhatsApp.',
  },
  {
    id: 'ewallet',
    label: 'E-Wallet',
    short: 'E-Wallet',
    description: 'GoPay, OVO, DANA, atau ShopeePay dengan verifikasi manual admin.',
  },
  {
    id: 'cash',
    label: 'Tunai di Tempat',
    short: 'Tunai',
    description: 'Bayar tunai saat mengambil pesanan atau saat pesanan diantar.',
  },
];

const PAYMENT_METHOD_IDS = PAYMENT_METHODS.map((method) => method.id);

const PAYMENT_INFO = {
  methods: PAYMENT_METHODS,
  bank: {
    name: process.env.PAYMENT_BANK_NAME || 'BCA',
    account: process.env.PAYMENT_BANK_ACCOUNT || '1234567890',
    holder: process.env.PAYMENT_BANK_HOLDER || 'Yayasan REKANA',
  },
  qris: {
    label: process.env.PAYMENT_QRIS_LABEL || 'QRIS REKANA (contoh)',
    note: 'Kode QRIS resmi dapat diminta melalui WhatsApp admin. Pembayaran tetap diverifikasi manual.',
  },
  ewallet: {
    name: process.env.PAYMENT_EWALLET_NAME || 'GoPay / OVO / DANA',
    number: process.env.PAYMENT_EWALLET_NUMBER || '0812-0000-0000',
    holder: process.env.PAYMENT_EWALLET_HOLDER || 'REKANA',
  },
  cash: {
    note: 'Bayar tunai saat mengambil pesanan di posko atau saat pesanan diantar. Admin akan mengonfirmasi waktu dan tempat.',
  },
  note: 'Pembayaran diverifikasi manual oleh admin. Tidak ada payment gateway; jangan mengirim uang sebelum kode pesanan diterima.',
};

function formatRp(value) {
  return 'Rp ' + Number(value || 0).toLocaleString('id-ID');
}

function isPaymentMethod(value) {
  return PAYMENT_METHOD_IDS.includes(String(value || ''));
}

function paymentMethodInfo(methodId) {
  return PAYMENT_METHODS.find((method) => method.id === methodId) || null;
}

function buildPaymentInstructions(methodId, options = {}) {
  const code = String(options.code || '').trim();
  const total = formatRp(options.total);
  const method = paymentMethodInfo(methodId);
  if (!method) return [];

  if (methodId === 'transfer') {
    return [
      `Transfer tepat ${total} ke rekening ${PAYMENT_INFO.bank.name} ${PAYMENT_INFO.bank.account} a.n. ${PAYMENT_INFO.bank.holder}.`,
      `Cantumkan kode pesanan ${code} pada berita transfer.`,
      'Kirim bukti transfer ke WhatsApp admin agar pembayaran dapat diverifikasi.',
    ];
  }

  if (methodId === 'qris') {
    return [
      'Buka aplikasi m-banking atau e-wallet, lalu pilih menu QRIS.',
      `Pindai ${PAYMENT_INFO.qris.label} dan pastikan nominal ${total}.`,
      `Cantumkan kode pesanan ${code} pada catatan pembayaran bila tersedia.`,
      'Kirim tangkapan layar bukti pembayaran ke WhatsApp admin.',
    ];
  }

  if (methodId === 'ewallet') {
    return [
      `Kirim tepat ${total} ke ${PAYMENT_INFO.ewallet.name} ${PAYMENT_INFO.ewallet.number} a.n. ${PAYMENT_INFO.ewallet.holder}.`,
      `Cantumkan kode pesanan ${code} pada catatan transaksi.`,
      'Kirim bukti pembayaran ke WhatsApp admin agar pembayaran dapat diverifikasi.',
    ];
  }

  return [
    `Siapkan uang tunai sebesar ${total}.`,
    `Tunjukkan kode pesanan ${code} kepada petugas saat mengambil atau menerima pesanan.`,
    PAYMENT_INFO.cash.note,
  ];
}

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_METHOD_IDS,
  PAYMENT_INFO,
  formatRp,
  isPaymentMethod,
  paymentMethodInfo,
  buildPaymentInstructions,
};
