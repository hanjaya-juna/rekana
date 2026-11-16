/* REKANA — logika antarmuka */
(() => {
  'use strict';

  const API_BASE = location.protocol === 'file:' ? 'http://localhost:3000' : '';
  const WA_FALLBACK = '6281200000000';
  const LS = {
    cache: 'rekana.publicCache.v2',
    session: 'rekana.session.v2',
    draft: 'rekana.reportDraft.v2',
    queue: 'rekana.reportQueue.v2',
    cart: 'rekana.cart.v2',
    lastOrder: 'rekana.lastOrder.v2',
  };
  const VIEW_TITLES = {
    katalog: 'Katalog',
    informasi: 'Info Bencana',
    lapor: 'Lapor Kejadian',
    pembayaran: 'Pembayaran',
    dashboard: 'Dashboard Admin',
  };

  const PAYMENT_FALLBACK = {
    methods: [
      { id: 'transfer', label: 'Transfer Bank', short: 'Transfer', description: 'Transfer ke rekening REKANA, lalu kirim bukti melalui WhatsApp.' },
      { id: 'qris', label: 'QRIS', short: 'QRIS', description: 'Pindai kode QRIS, lalu kirim bukti melalui WhatsApp.' },
      { id: 'ewallet', label: 'E-Wallet', short: 'E-Wallet', description: 'GoPay, OVO, DANA, atau ShopeePay.' },
      { id: 'cash', label: 'Tunai di Tempat', short: 'Tunai', description: 'Bayar tunai saat mengambil atau menerima pesanan.' },
    ],
    bank: { name: 'BCA', account: '1234567890', holder: 'Yayasan REKANA' },
    qris: { label: 'QRIS REKANA (contoh)', note: 'Kode QRIS resmi dapat diminta melalui WhatsApp admin.' },
    ewallet: { name: 'GoPay / OVO / DANA', number: '0812-0000-0000', holder: 'REKANA' },
    cash: { note: 'Bayar tunai saat mengambil pesanan di posko atau saat pesanan diantar.' },
    note: 'Pembayaran diverifikasi manual oleh admin. Tidak ada payment gateway.',
  };
  const TX_STATUS_LABEL = {
    pending: 'Menunggu pembayaran',
    verified: 'Terverifikasi',
    cancelled: 'Dibatalkan',
  };

  const state = {
    publicData: null,
    adminData: null,
    token: '',
    admin: null,
    offline: false,
    cacheSavedAt: 0,
    adminLoading: false,
    view: 'katalog',
    activeTab: 'ringkasan',
    catalog: { q: '', category: 'Semua', sort: 'featured' },
    info: { q: '', type: 'Semua' },
    mod: { q: '', status: 'all' },
    tx: { q: '', status: 'all' },
    queue: [],
    cart: [],
    paymentMethod: 'transfer',
    lastOrder: null,
    lookup: null,
    checkoutBusy: false,
    editingProduct: null,
    editingWarning: null,
    editingCategory: null,
    editingTransaction: null,
  };

  let syncingQueue = false;
  let toastTimer = 0;

  // ---------------------------------------------------------------------------
  // Utilitas umum
  // ---------------------------------------------------------------------------

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const esc = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));

  const pad2 = (n) => String(n).padStart(2, '0');

  function readLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      try { localStorage.removeItem(key); } catch { /* abaikan */ }
      return fallback;
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      toast('Penyimpanan browser tidak tersedia atau penuh. Data lokal tidak dapat disimpan.', 'error');
      return false;
    }
  }

  function removeLS(key) {
    try { localStorage.removeItem(key); } catch { /* abaikan */ }
  }

  function toast(message, type = '', duration = 4200) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast on' + (type === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      el.className = 'toast';
    }, duration);
  }

  function busyButton(btn, busy, busyLabel = 'Menyimpan…') {
    if (!btn) return;
    if (!btn.dataset.normalLabel) btn.dataset.normalLabel = btn.textContent;
    btn.disabled = busy;
    btn.textContent = busy ? busyLabel : btn.dataset.normalLabel;
  }

  function confirmAction(message, title = 'Konfirmasi') {
    return new Promise((resolve) => {
      const dialog = $('#confirmDialog');
      $('#confirmTitle').textContent = title;
      $('#confirmMessage').textContent = message;
      dialog.returnValue = '';
      const onClose = () => {
        dialog.removeEventListener('close', onClose);
        resolve(dialog.returnValue === 'ok');
      };
      dialog.addEventListener('close', onClose);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close('cancel');
    else dialog.removeAttribute('open');
  }

  function ymdLocal(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function todayLocal() {
    return ymdLocal(new Date());
  }

  function nowLocalInput() {
    const d = new Date();
    d.setSeconds(0, 0);
    return `${ymdLocal(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function toInputValue(value) {
    const d = toDate(value);
    if (!d) return '';
    return `${ymdLocal(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function parseYmd(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const d = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }

  function toDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') return new Date(value);
    if (!value) return null;
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return parseYmd(text);
    const d = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDate(value, options = {}) {
    const d = toDate(value);
    if (!d) return '—';
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...options,
    });
  }

  function formatWeekday(value, style = 'long') {
    const d = toDate(value);
    if (!d) return '—';
    return d.toLocaleDateString('id-ID', { weekday: style });
  }

  function formatDateTime(value) {
    const d = toDate(value);
    if (!d) return '—';
    return d.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatClock(value) {
    const d = toDate(value);
    if (!d) return '—';
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  function formatSaved(ts) {
    const d = new Date(Number(ts) || Date.now());
    return d.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function relativeTime(value) {
    const d = toDate(value);
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    if (diff < 0) return formatDateTime(value);
    if (diff < 60_000) return 'baru saja';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} menit lalu`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} jam lalu`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} hari lalu`;
    return formatDate(value);
  }

  function formatRp(value) {
    return 'Rp ' + Number(value || 0).toLocaleString('id-ID');
  }

  function safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#22385a';
  }

  function levelClass(level) {
    return ['Normal', 'Waspada', 'Siaga', 'Awas'].includes(level) ? `lv-${level}` : 'lv-Normal';
  }

  function warningLevelClass(level) {
    return ['Waspada', 'Siaga', 'Awas'].includes(level) ? `level-${level}` : 'level-Waspada';
  }

  function stockInfo(stock) {
    const n = Number(stock) || 0;
    if (n <= 0) return { label: 'Habis', className: 'stock-out' };
    if (n <= 5) return { label: 'Stok menipis', className: 'stock-low' };
    return { label: 'Tersedia', className: 'stock-ok' };
  }

  function placeholderSvg(product) {
    const color = safeColor(product && product.categoryColor);
    const initials = (String(product && product.name || 'R').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || 'R').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140"><rect width="200" height="140" fill="${color}"/><g fill="none" stroke="rgba(255,235,190,.38)" stroke-width="3"><ellipse cx="100" cy="38" rx="14" ry="26"/><ellipse cx="100" cy="102" rx="14" ry="26"/><ellipse cx="68" cy="70" rx="26" ry="14"/><ellipse cx="132" cy="70" rx="26" ry="14"/></g><text x="100" y="86" font-size="44" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#fff">${initials}</text></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function imageSrc(product) {
    const url = String(product && product.imageUrl || '').trim();
    if (/^(https?:\/\/|assets\/|\/(?!\/))/i.test(url)) return url;
    return placeholderSvg(product);
  }

  function waLink(product) {
    const number = String((state.publicData && state.publicData.waNumber) || WA_FALLBACK).replace(/\D/g, '') || WA_FALLBACK;
    const text = encodeURIComponent(`Halo, saya ingin memesan ${product.name} (${formatRp(product.price)}).`);
    return `https://wa.me/${number}?text=${text}`;
  }

  function mapLink(lat, lng) {
    const la = Number(lat);
    const lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return '';
    return `https://www.google.com/maps?q=${la},${lo}`;
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value == null ? '' : String(value);
  }

  function setHtml(selector, value) {
    const el = $(selector);
    if (el) el.innerHTML = value;
  }

  // ---------------------------------------------------------------------------
  // API dan sesi
  // ---------------------------------------------------------------------------

  async function api(path, options = {}) {
    const method = options.method || 'GET';
    const body = options.body;
    const auth = Boolean(options.auth);
    const timeout = options.timeout || 15000;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      if (!state.token) {
        const err = new Error('Sesi admin tidak ditemukan. Silakan masuk kembali.');
        err.status = 401;
        throw err;
      }
      headers.Authorization = `Bearer ${state.token}`;
    }

    try {
      const response = await fetch(API_BASE + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
      let data = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json().catch(() => null);
      }
      if (!response.ok) {
        const err = new Error((data && data.message) || `Permintaan gagal (${response.status}).`);
        err.status = response.status;
        err.errors = (data && data.errors) || {};
        err.data = data;
        if (response.status === 401 && auth) expireSession();
        throw err;
      }
      return data || { ok: true };
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutErr = new Error('Server tidak merespons. Periksa koneksi lalu coba lagi.');
        timeoutErr.network = true;
        throw timeoutErr;
      }
      if (err instanceof TypeError) {
        const networkErr = new Error('Tidak dapat terhubung ke server. Pastikan "npm start" dan MySQL berjalan.');
        networkErr.network = true;
        throw networkErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function saveSession(token, admin) {
    state.token = token;
    state.admin = admin;
    writeLS(LS.session, { token, admin, savedAt: Date.now() });
  }

  function clearSession() {
    state.token = '';
    state.admin = null;
    state.adminData = null;
    removeLS(LS.session);
  }

  function expireSession() {
    if (!state.token && !state.admin) return;
    clearSession();
    renderHeader();
    renderDashboard();
    updateConnection();
    toast('Sesi admin berakhir. Silakan masuk kembali.', 'error');
  }

  async function validateSession() {
    if (!state.token) return;
    try {
      const result = await api('/api/admin/me', { auth: true });
      state.admin = result.admin;
      writeLS(LS.session, { token: state.token, admin: result.admin, savedAt: Date.now() });
    } catch (err) {
      if (err.status === 401) expireSession();
    }
    renderHeader();
  }

  // ---------------------------------------------------------------------------
  // Cache publik, data admin, dan antrean laporan
  // ---------------------------------------------------------------------------

  function publicSubset(data) {
    return {
      serverTime: data.serverTime,
      today: data.today,
      waNumber: data.waNumber,
      categories: data.categories || [],
      products: data.products || [],
      weather: data.weather || [],
      warnings: data.warnings || [],
      incidents: data.incidents || [],
      payment: data.payment || PAYMENT_FALLBACK,
      stats: data.stats || {},
    };
  }

  function applyCache() {
    const cached = readLS(LS.cache, null);
    if (!cached || !cached.data || !Array.isArray(cached.data.products) || !Array.isArray(cached.data.weather)) {
      return false;
    }
    state.publicData = cached.data;
    state.cacheSavedAt = Number(cached.savedAt) || 0;
    return true;
  }

  function saveCache(data) {
    const savedAt = Date.now();
    if (writeLS(LS.cache, { savedAt, data: publicSubset(data) })) {
      state.cacheSavedAt = savedAt;
    }
  }

  async function loadPublic(options = {}) {
    const silent = Boolean(options.silent);
    try {
      const result = await api('/api/bootstrap');
      if (!result || !result.data) throw new Error('Data publik tidak lengkap.');
      state.publicData = result.data;
      state.offline = false;
      saveCache(result.data);
      renderAll();
    } catch (err) {
      state.offline = true;
      if (!state.publicData) applyCache();
      renderAll();
      if (!silent) toast(err.message, 'error');
    }
  }

  async function loadAdminData(options = {}) {
    const silent = Boolean(options.silent);
    if (!state.token || state.adminLoading) return;
    state.adminLoading = true;
    try {
      const result = await api('/api/admin/data', { auth: true });
      applyAdminPayload(result.data);
    } catch (err) {
      if (err.status === 401) expireSession();
      else if (!silent) toast(err.message, 'error');
      renderDashboard();
    } finally {
      state.adminLoading = false;
    }
  }

  function applyAdminPayload(data) {
    if (!data) return;
    state.adminData = data;
    state.publicData = publicSubset(data);
    state.offline = false;
    saveCache(data);
    renderAll();
  }

  function applyFormErrors(form, errors, box, message) {
    if (!form) return;
    $$('[data-err]', form).forEach((el) => { el.textContent = ''; });
    const entries = Object.entries(errors || {});
    entries.forEach(([key, value]) => {
      const target = $$('[data-err]', form).find((el) => el.dataset.err === key);
      if (target) target.textContent = value;
    });
    if (box) {
      const messages = entries.map(([, value]) => value).filter(Boolean);
      box.textContent = messages.length ? (message ? `${message} ` : '') + messages.join(' ') : (message || '');
    }
  }

  function clearFormErrors(form, box) {
    if (form) $$('[data-err]', form).forEach((el) => { el.textContent = ''; });
    if (box) box.textContent = '';
  }

  // ---------------------------------------------------------------------------
  // Laporan masyarakat: draf dan antrean localStorage
  // ---------------------------------------------------------------------------

  function collectReport() {
    const form = $('#reportForm');
    if (!form) return {};
    const data = new FormData(form);
    return {
      title: String(data.get('title') || '').trim(),
      type: String(data.get('type') || '').trim(),
      occurredAt: String(data.get('occurredAt') || '').trim(),
      location: String(data.get('location') || '').trim(),
      summary: String(data.get('summary') || '').trim(),
      reporterName: String(data.get('reporterName') || '').trim(),
      reporterContact: String(data.get('reporterContact') || '').trim(),
      lat: String(data.get('lat') || '').trim(),
      lng: String(data.get('lng') || '').trim(),
    };
  }

  function validateReport(payload) {
    const errors = {};
    if (payload.title.length < 3 || payload.title.length > 120) {
      errors.title = 'Judul harus 3 sampai 120 karakter.';
    }
    if (!payload.type) errors.type = 'Pilih jenis kejadian.';
    if (payload.location.length < 2 || payload.location.length > 120) {
      errors.location = 'Lokasi harus 2 sampai 120 karakter.';
    }
    if (payload.summary.length < 5 || payload.summary.length > 600) {
      errors.summary = 'Ringkasan harus 5 sampai 600 karakter.';
    }
    if (payload.reporterContact.length > 80) {
      errors.reporterContact = 'Kontak maksimal 80 karakter.';
    }
    if (payload.occurredAt && !toDate(payload.occurredAt)) {
      errors.occurredAt = 'Waktu kejadian tidak valid.';
    }
    const hasLat = payload.lat !== '';
    const hasLng = payload.lng !== '';
    if (hasLat !== hasLng) {
      errors.lat = 'Latitude dan longitude harus diisi berpasangan.';
      errors.lng = 'Latitude dan longitude harus diisi berpasangan.';
    } else if (hasLat) {
      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = 'Latitude harus antara -90 dan 90.';
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.lng = 'Longitude harus antara -180 dan 180.';
    }
    return errors;
  }

  function updateDraftStatus() {
    const el = $('#draftStatus');
    if (!el) return;
    const draft = readLS(LS.draft, null);
    el.textContent = draft && draft.savedAt
      ? `Draf tersimpan di perangkat · ${formatSaved(draft.savedAt)}`
      : 'Draf otomatis tersimpan saat Anda mengetik.';
  }

  function saveReportDraft() {
    const payload = collectReport();
    const meaningful = ['title', 'type', 'location', 'summary', 'reporterName', 'reporterContact', 'lat', 'lng']
      .some((key) => payload[key] !== '');
    if (!meaningful) {
      removeLS(LS.draft);
      updateDraftStatus();
      return;
    }
    writeLS(LS.draft, { savedAt: Date.now(), values: payload });
    updateDraftStatus();
  }

  function restoreReportDraft() {
    const draft = readLS(LS.draft, null);
    if (draft && draft.values) {
      const form = $('#reportForm');
      Object.entries(draft.values).forEach(([key, value]) => {
        const field = form && form.elements.namedItem(key);
        if (field) field.value = value == null ? '' : String(value);
      });
    } else {
      const occurred = $('#r-occurredAt');
      if (occurred) occurred.value = nowLocalInput();
    }
    updateDraftStatus();
  }

  function clearReportForm() {
    const form = $('#reportForm');
    if (form) form.reset();
    const occurred = $('#r-occurredAt');
    if (occurred) occurred.value = nowLocalInput();
    removeLS(LS.draft);
    updateDraftStatus();
    clearFormErrors(form, $('#reportError'));
  }

  function queueReport(payload) {
    state.queue.push({
      localId: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      payload,
      savedAt: Date.now(),
    });
    writeLS(LS.queue, state.queue);
    renderReportQueue();
  }

  async function syncQueue(options = {}) {
    const silent = Boolean(options.silent);
    if (syncingQueue) return;
    if (!state.queue.length) {
      renderReportQueue();
      return;
    }
    if (!navigator.onLine) {
      if (!silent) toast('Belum ada koneksi internet. Antrean tetap tersimpan di perangkat.', 'error');
      renderReportQueue();
      return;
    }

    syncingQueue = true;
    renderReportQueue();
    let sent = 0;
    let rejected = 0;
    let stopped = false;
    const remaining = [];

    for (const item of state.queue) {
      if (stopped) {
        remaining.push(item);
        continue;
      }
      try {
        await api('/api/incidents', { method: 'POST', body: item.payload });
        sent += 1;
      } catch (err) {
        if (err.network || err.status >= 500) {
          remaining.push(item);
          stopped = true;
        } else if (err.status === 400 || err.status === 429) {
          rejected += 1;
        } else {
          remaining.push(item);
        }
      }
    }

    state.queue = remaining;
    writeLS(LS.queue, state.queue);
    syncingQueue = false;
    renderReportQueue();

    if (sent > 0) {
      toast(`${sent} laporan dalam antrean berhasil dikirim ke server.`);
      await loadPublic({ silent: true });
    }
    if (rejected > 0) {
      toast(`${rejected} laporan ditolak server karena datanya tidak valid.`, 'error');
    }
    if (!silent && sent === 0 && rejected === 0 && state.queue.length > 0) {
      toast('Belum dapat mengirim antrean. Periksa koneksi atau server.', 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Render umum: header, status koneksi, sumber data
  // ---------------------------------------------------------------------------

  function renderHeader() {
    const navDashboard = $('#navDashboard');
    const loginBtn = $('#loginBtn');
    const logoutBtn = $('#logoutBtn');
    const adminChip = $('#adminChip');
    const isAdmin = Boolean(state.admin);

    if (navDashboard) navDashboard.hidden = !isAdmin;
    if (loginBtn) loginBtn.hidden = isAdmin;
    if (logoutBtn) logoutBtn.hidden = !isAdmin;
    if (adminChip) {
      adminChip.hidden = !isAdmin;
      adminChip.textContent = isAdmin
        ? `Admin · ${state.admin.name || state.admin.username || 'Aktif'}`
        : '';
    }
    updateConnection();
    renderOfflineBar();
  }

  function updateConnection() {
    const el = $('#connectionBadge');
    if (!el) return;
    el.classList.remove('is-online', 'is-cache', 'is-offline');
    if (state.offline) {
      el.classList.add('is-offline');
      el.textContent = state.publicData ? 'Luring · cache lokal' : 'Server luring';
    } else if (state.publicData) {
      el.classList.add('is-online');
      el.textContent = 'MySQL aktif';
    } else {
      el.classList.add('is-cache');
      el.textContent = 'Menghubungkan…';
    }
  }

  function renderOfflineBar() {
    const bar = $('#offlineBar');
    if (!bar) return;
    if (!state.offline) {
      bar.hidden = true;
      bar.textContent = '';
      return;
    }
    bar.hidden = false;
    if (state.publicData) {
      const when = state.cacheSavedAt ? ` dari ${formatSaved(state.cacheSavedAt)}` : '';
      bar.textContent = `Mode luring: menampilkan cache lokal${when}. Perubahan admin memerlukan koneksi ke MySQL.`;
    } else {
      bar.textContent = 'Tidak dapat terhubung ke server. Jalankan "npm start", pastikan MySQL aktif, lalu muat ulang halaman.';
    }
  }

  function dataSourceLabel() {
    if (state.offline && state.publicData) {
      return `Cache lokal${state.cacheSavedAt ? ' · ' + formatSaved(state.cacheSavedAt) : ''}`;
    }
    if (state.publicData) return 'MySQL';
    return 'Menunggu server';
  }

  function updateSourceLabels() {
    const label = dataSourceLabel();
    const catalogSource = $('#catalogSource');
    const infoSource = $('#infoSource');
    if (catalogSource) {
      catalogSource.textContent = label;
      catalogSource.className = 'badge ' + (state.offline ? 'badge-warning' : 'badge-success');
    }
    if (infoSource) {
      const time = state.publicData && state.publicData.serverTime
        ? formatDateTime(state.publicData.serverTime)
        : state.cacheSavedAt ? formatSaved(state.cacheSavedAt) : '';
      infoSource.textContent = time ? `${label} · ${time}` : label;
      infoSource.className = 'badge ' + (state.offline ? 'badge-warning' : 'badge-success');
    }
  }

  function renderAll() {
    renderHeader();
    renderHero();
    renderCatalog();
    renderInfo();
    renderReportQueue();
    renderPayment();
    renderDashboard();
    updateSourceLabels();
  }

  // ---------------------------------------------------------------------------
  // Hero dan katalog
  // ---------------------------------------------------------------------------

  function getTodayWeather(data = state.publicData) {
    if (!data || !Array.isArray(data.weather) || data.weather.length === 0) return null;
    const today = data.today || todayLocal();
    return data.weather.find((w) => w.date === today) || data.weather[0];
  }

  function renderHero() {
    const badge = $('#heroBadge');
    const strip = $('#heroStrip');
    if (!badge || !strip) return;
    const data = state.publicData;
    const today = getTodayWeather(data);

    if (!data) {
      badge.className = 'badge badge-hero';
      badge.textContent = state.offline ? 'Data belum tersedia' : 'Memuat prakiraan…';
      strip.innerHTML = '<p class="hero-side-label" style="grid-column:1/-1;margin:0">Menghubungkan ke server…</p>';
      return;
    }

    if (!today) {
      badge.className = 'badge badge-hero';
      badge.textContent = 'Prakiraan belum diisi admin';
      strip.innerHTML = '<p class="hero-side-label" style="grid-column:1/-1;margin:0">Belum ada data cuaca.</p>';
      return;
    }

    badge.className = `badge badge-hero ${levelClass(today.alertLevel)}`;
    badge.textContent = `Hari ini: ${today.condition} · ${today.alertLevel}`;

    const weather = data.weather.slice(0, 8);
    strip.innerHTML = weather.map((w) => {
      const isToday = w.date === today.date;
      const label = isToday ? 'Kini' : formatWeekday(w.date, 'short');
      const title = `${formatDate(w.date)} · ${w.condition} · ${w.alertLevel}`;
      return `<a class="strip-item ${levelClass(w.alertLevel)}" href="#informasi" title="${esc(title)}"><i></i><span>${esc(label)}</span></a>`;
    }).join('');
  }

  function renderCatalog() {
    const data = state.publicData;
    const chips = $('#chips');
    const count = $('#count');
    const grid = $('#grid');
    if (!chips || !count || !grid) return;

    if (!data) {
      chips.innerHTML = '';
      count.textContent = '';
      grid.innerHTML = state.offline
        ? `<div class="empty"><strong>Server belum terhubung</strong><p>Jalankan <code>npm start</code> dan pastikan MySQL aktif. Setelah itu tekan tombol di bawah.</p><button class="btn btn-alt" type="button" data-retry>Muat ulang data</button></div>`
        : `<div class="empty"><strong>Memuat katalog…</strong><p>Mengambil data produk dari MySQL.</p></div>`;
      return;
    }

    const categories = ['Semua', ...(data.categories || []).map((c) => c.name)];
    if (state.catalog.category !== 'Semua' && !categories.includes(state.catalog.category)) {
      state.catalog.category = 'Semua';
    }

    chips.innerHTML = categories.map((name) => (
      `<button type="button" class="chip" aria-pressed="${name === state.catalog.category}" data-category="${esc(name)}">${esc(name)}</button>`
    )).join('');

    let products = (data.products || []).slice();
    const query = state.catalog.q.toLowerCase().trim();
    products = products.filter((p) => {
      const inCategory = state.catalog.category === 'Semua' || p.category === state.catalog.category;
      const haystack = `${p.name} ${p.description}`.toLowerCase();
      return inCategory && (!query || haystack.includes(query));
    });

    const sorters = {
      featured: (a, b) => (Number(b.featured) - Number(a.featured)) || a.name.localeCompare(b.name, 'id'),
      name: (a, b) => a.name.localeCompare(b.name, 'id'),
      priceAsc: (a, b) => Number(a.price) - Number(b.price),
      priceDesc: (a, b) => Number(b.price) - Number(a.price),
      stock: (a, b) => Number(b.stock) - Number(a.stock),
    };
    products.sort(sorters[state.catalog.sort] || sorters.featured);

    count.textContent = `${products.length} dari ${(data.products || []).length} produk`;
    if (products.length === 0) {
      grid.innerHTML = '<div class="empty"><strong>Produk tidak ditemukan</strong><p>Coba kata kunci lain atau pilih kategori Semua.</p></div>';
      return;
    }

    grid.innerHTML = products.map((p) => {
      const stock = stockInfo(p.stock);
      const color = safeColor(p.categoryColor);
      const hasStock = Number(p.stock) > 0;
      const addButton = hasStock
        ? `<button class="btn" type="button" data-add-to-cart="${esc(p.id)}">Tambah</button>`
        : '<span class="btn" aria-disabled="true" role="link">Stok habis</span>';
      const waButton = hasStock
        ? `<a class="btn btn-alt btn-sm" href="${esc(waLink(p))}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
        : '';
      return `<article class="card">
        <div class="card-media">
          <img data-product-image="${esc(p.id)}" src="${esc(imageSrc(p))}" alt="${esc(p.name)}" loading="lazy">
          ${p.featured ? '<span class="card-flag">Unggulan</span>' : ''}
        </div>
        <div class="cb">
          <span class="cat" style="color:${color}">${esc(p.category)}</span>
          <h3>${esc(p.name)}</h3>
          <p class="desc">${esc(p.description || 'Perlengkapan siaga bencana.')}</p>
          <div class="price">${formatRp(p.price)}</div>
          <span class="stock ${stock.className}">${stock.label}: ${Number(p.stock) || 0}</span>
          <div class="card-actions">${addButton}${waButton}</div>
        </div>
      </article>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Info bencana
  // ---------------------------------------------------------------------------

  function renderInfo() {
    const data = state.publicData;
    renderWarningsPublic();
    renderTodayWeather();
    renderWeekWeather();
    renderIncidentFilter();
    renderIncidentList();

    const todayDate = $('#todayDate');
    if (todayDate) {
      todayDate.textContent = data && data.today ? formatDate(data.today, { weekday: 'long' }) : '';
    }
  }

  function renderWarningsPublic() {
    const list = $('#warningList');
    if (!list) return;
    const data = state.publicData;
    if (!data) {
      list.innerHTML = '<div class="empty"><strong>Memuat peringatan…</strong><p>Menunggu data dari MySQL.</p></div>';
      return;
    }
    const warnings = data.warnings || [];
    if (warnings.length === 0) {
      list.innerHTML = '<div class="empty"><strong>Tidak ada peringatan aktif</strong><p>Admin belum menerbitkan peringatan dalam rentang waktu saat ini.</p></div>';
      return;
    }
    list.innerHTML = warnings.map((w) => {
      const end = w.endsAt ? formatDateTime(w.endsAt) : 'sampai dicabut';
      return `<article class="warning-card ${warningLevelClass(w.level)}">
        <div class="warning-icon" aria-hidden="true">!</div>
        <div>
          <span class="level-pill">${esc(w.level)}</span>
          <h3>${esc(w.title)}</h3>
          <p>${esc(w.message)}</p>
          <div class="warning-meta">
            <span>Wilayah: ${esc(w.area)}</span>
            <span>Berlaku: ${formatDateTime(w.startsAt)} — ${end}</span>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  function renderTodayWeather() {
    const container = $('#today');
    if (!container) return;
    const data = state.publicData;
    if (!data) {
      container.innerHTML = '<div class="empty"><strong>Memuat cuaca…</strong></div>';
      return;
    }
    const today = getTodayWeather(data);
    if (!today) {
      container.innerHTML = '<div class="empty"><strong>Cuaca belum tersedia</strong><p>Admin belum mengisi prakiraan.</p></div>';
      return;
    }
    container.innerHTML = `<div class="today-card ${levelClass(today.alertLevel)}">
      <div class="today-top">
        <div>
          <span class="eyebrow">${esc(today.condition)}</span>
          <h3>${today.tempMin}–${today.tempMax} °C</h3>
        </div>
        <span class="alert-label ${levelClass(today.alertLevel)}">Kewaspadaan ${esc(today.alertLevel)}</span>
      </div>
      <div class="today-facts">
        <div class="fact"><b>${today.tempMin}–${today.tempMax} °C</b><span>Suhu</span></div>
        <div class="fact"><b>${Number(today.rainChance) || 0}%</b><span>Peluang hujan</span></div>
        <div class="fact"><b>${esc(today.condition)}</b><span>Kondisi</span></div>
      </div>
      <p class="muted" style="margin:14px 0 0;font-size:.78rem">Diperbarui ${formatDateTime(today.updatedAt)}</p>
    </div>`;
  }

  function renderWeekWeather() {
    const container = $('#week');
    if (!container) return;
    const data = state.publicData;
    if (!data) {
      container.innerHTML = '<div class="empty"><strong>Memuat prakiraan…</strong></div>';
      return;
    }
    const today = getTodayWeather(data);
    const rest = (data.weather || []).filter((w) => !today || w.date !== today.date).slice(0, 7);
    if (rest.length === 0) {
      container.innerHTML = '<div class="empty"><strong>Prakiraan belum tersedia</strong></div>';
      return;
    }
    container.innerHTML = rest.map((w) => `<div class="day ${levelClass(w.alertLevel)}">
      <b>${esc(formatWeekday(w.date, 'long'))}</b>
      <small>${formatDate(w.date)}</small>
      <div class="day-cond" title="${esc(w.condition)}">${esc(w.condition)}</div>
      <small>${w.tempMin}–${w.tempMax} °C · ${Number(w.rainChance) || 0}%</small>
      <div><span class="badge ${levelClass(w.alertLevel)}">${esc(w.alertLevel)}</span></div>
    </div>`).join('');
  }

  function renderIncidentFilter() {
    const select = $('#incidentFilter');
    if (!select) return;
    const incidents = (state.publicData && state.publicData.incidents) || [];
    const types = Array.from(new Set(incidents.map((i) => i.type).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'id'));
    if (!types.includes(state.info.type)) state.info.type = 'Semua';
    select.innerHTML = '<option value="Semua">Semua jenis</option>' +
      types.map((type) => `<option value="${esc(type)}">${esc(type)}</option>`).join('');
    select.value = state.info.type;
  }

  function renderIncidentList() {
    const list = $('#incidentList');
    if (!list) return;
    const data = state.publicData;
    if (!data) {
      list.innerHTML = '<div class="empty"><strong>Memuat kejadian…</strong><p>Menunggu data dari MySQL.</p></div>';
      return;
    }
    const query = state.info.q.toLowerCase().trim();
    const incidents = (data.incidents || []).filter((incident) => {
      const typeMatch = state.info.type === 'Semua' || incident.type === state.info.type;
      const haystack = `${incident.title} ${incident.summary} ${incident.location} ${incident.type}`.toLowerCase();
      return typeMatch && (!query || haystack.includes(query));
    });

    if (incidents.length === 0) {
      list.innerHTML = '<div class="empty"><strong>Tidak ada kejadian yang cocok</strong><p>Ubah kata kunci atau pilih jenis kejadian lain.</p></div>';
      return;
    }

    list.innerHTML = incidents.map((incident) => {
      const point = mapLink(incident.lat, incident.lng);
      return `<article class="news-card">
        <div class="news-top">
          <span class="type-pill">${esc(incident.type || 'Lainnya')}</span>
          <span class="status-pill status-published">Terverifikasi</span>
          <span class="badge badge-muted">${esc(relativeTime(incident.occurredAt))}</span>
        </div>
        <h3>${esc(incident.title)}</h3>
        <p>${esc(incident.summary)}</p>
        <div class="news-meta">
          <span>Lokasi: ${esc(incident.location)}</span>
          <span>Waktu: ${formatDateTime(incident.occurredAt)}</span>
          ${point ? `<a href="${esc(point)}" target="_blank" rel="noopener noreferrer">Lihat titik lokasi</a>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Antrean laporan
  // ---------------------------------------------------------------------------

  function renderReportQueue() {
    const panel = $('#queuePanel');
    const list = $('#queueList');
    const count = $('#queueCount');
    const syncBtn = $('#syncQueueBtn');
    if (!panel || !list || !count || !syncBtn) return;

    panel.hidden = state.queue.length === 0;
    count.textContent = String(state.queue.length);
    syncBtn.disabled = syncingQueue || !navigator.onLine;
    syncBtn.textContent = syncingQueue ? 'Mengirim antrean…' : 'Coba kirim sekarang';

    list.innerHTML = state.queue.map((item) => {
      const p = item.payload || {};
      return `<div class="queue-item">
        <b>${esc(p.title || 'Laporan tanpa judul')}</b>
        <small>${esc(p.type || 'Lainnya')} · ${esc(p.location || 'Lokasi belum diisi')} · disimpan ${formatSaved(item.savedAt)}</small>
      </div>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Keranjang dan pembayaran publik
  // ---------------------------------------------------------------------------

  function paymentConfig() {
    const payment = state.publicData && state.publicData.payment;
    if (payment && Array.isArray(payment.methods) && payment.methods.length) return payment;
    return PAYMENT_FALLBACK;
  }

  function allProductMap() {
    const map = new Map();
    const add = (product) => {
      if (product && product.id) map.set(product.id, product);
    };
    ((state.publicData && state.publicData.products) || []).forEach(add);
    ((state.adminData && state.adminData.products) || []).forEach(add);
    return map;
  }

  function reconcileCart() {
    if (!state.publicData) return;
    const products = allProductMap();
    let changed = false;
    const next = [];
    state.cart.forEach((item) => {
      const product = products.get(item.id);
      if (!product || Number(product.stock) <= 0) {
        changed = true;
        return;
      }
      const max = Math.min(99, Number(product.stock));
      const quantity = Math.min(Math.max(1, Number(item.quantity) || 0), max);
      if (quantity !== Number(item.quantity)) changed = true;
      next.push({ id: item.id, quantity });
    });
    if (changed) {
      state.cart = next;
      writeLS(LS.cart, state.cart);
    }
  }

  function cartLines() {
    const products = allProductMap();
    return state.cart.map((item) => {
      const product = products.get(item.id);
      if (!product) return null;
      const stock = Number(product.stock) || 0;
      const quantity = Math.min(Math.max(1, Number(item.quantity) || 0), Math.max(1, stock));
      return {
        product,
        quantity,
        price: Number(product.price) || 0,
        subtotal: (Number(product.price) || 0) * quantity,
        stock,
      };
    }).filter(Boolean);
  }

  function cartCount() {
    return cartLines().reduce((sum, line) => sum + line.quantity, 0);
  }

  function cartTotal() {
    return cartLines().reduce((sum, line) => sum + line.subtotal, 0);
  }

  function renderCartBadge() {
    const badge = $('#navCartCount');
    if (!badge) return;
    const count = cartCount();
    badge.hidden = count === 0;
    badge.textContent = String(count);
    badge.setAttribute('aria-label', `${count} item di keranjang`);
  }

  function persistCart() {
    writeLS(LS.cart, state.cart);
    renderCartBadge();
    renderPayment();
  }

  function addToCart(id) {
    const product = allProductMap().get(id);
    if (!product) {
      toast('Produk tidak ditemukan. Muat ulang katalog.', 'error');
      return;
    }
    const stock = Number(product.stock) || 0;
    if (stock <= 0) {
      toast(`Stok ${product.name} sedang habis.`, 'error');
      return;
    }
    const existing = state.cart.find((item) => item.id === id);
    if (existing) {
      if (existing.quantity >= stock) {
        toast(`Jumlah ${product.name} sudah mencapai stok tersedia (${stock}).`, 'error');
        return;
      }
      existing.quantity += 1;
    } else {
      state.cart.push({ id, quantity: 1 });
    }
    persistCart();
    toast(`${product.name} ditambahkan ke keranjang.`);
  }

  function updateCartQuantity(id, quantity) {
    const product = allProductMap().get(id);
    const item = state.cart.find((entry) => entry.id === id);
    if (!item || !product) return;
    const stock = Number(product.stock) || 0;
    const next = Math.min(Math.max(0, Number(quantity) || 0), stock, 99);
    if (next <= 0 || stock <= 0) {
      removeCartItem(id, true);
      return;
    }
    item.quantity = next;
    persistCart();
  }

  function removeCartItem(id, silent = false) {
    state.cart = state.cart.filter((item) => item.id !== id);
    persistCart();
    if (!silent) toast('Produk dihapus dari keranjang.');
  }

  function clearCart(silent = false) {
    state.cart = [];
    removeLS(LS.cart);
    renderCartBadge();
    renderPayment();
    if (!silent) toast('Keranjang dikosongkan.');
  }

  function renderPayment() {
    reconcileCart();
    renderCartBadge();
    renderCart();
    renderCartSummary();
    renderPaymentMethods();
    renderDeliveryFields();
    renderOrderResult();
    renderLookupResult();
  }

  function renderCart() {
    const list = $('#cartList');
    if (!list) return;
    const lines = cartLines();
    const submit = $('#checkoutSubmit');
    const clear = $('#clearCartBtn');
    if (submit && !state.checkoutBusy) submit.disabled = lines.length === 0;
    if (clear) clear.disabled = lines.length === 0;

    if (lines.length === 0) {
      list.innerHTML = `<div class="empty">
        <strong>Keranjang masih kosong</strong>
        <p>Buka katalog lalu tekan <b>Tambah</b> pada produk yang ingin dipesan.</p>
        <a class="btn btn-alt" href="#katalog">Buka katalog</a>
      </div>`;
      return;
    }

    list.innerHTML = lines.map((line) => {
      const product = line.product;
      const stock = stockInfo(line.stock);
      return `<div class="cart-item">
        <img class="cart-thumb" data-product-image="${esc(product.id)}" src="${esc(imageSrc(product))}" alt="${esc(product.name)}" loading="lazy">
        <div class="cart-info">
          <b>${esc(product.name)}</b>
          <small>${formatRp(line.price)} · <span class="stock ${stock.className}" style="font-size:.68rem;padding:1px 6px">${stock.label}: ${line.stock}</span></small>
        </div>
        <div class="cart-controls">
          <div class="qty-stepper" aria-label="Jumlah ${esc(product.name)}">
            <button type="button" data-cart-minus="${esc(product.id)}" aria-label="Kurangi ${esc(product.name)}">−</button>
            <span>${line.quantity}</span>
            <button type="button" data-cart-plus="${esc(product.id)}" aria-label="Tambah ${esc(product.name)}">+</button>
          </div>
          <b class="cart-line-total">${formatRp(line.subtotal)}</b>
          <button class="cart-remove" type="button" data-cart-remove="${esc(product.id)}">Hapus</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderCartSummary() {
    const summary = $('#cartSummary');
    const count = $('#cartSummaryCount');
    const note = $('#paymentInfoNote');
    if (!summary) return;
    const lines = cartLines();
    const totalItems = lines.reduce((sum, line) => sum + line.quantity, 0);
    if (count) count.textContent = `${totalItems} item`;
    if (note) note.textContent = paymentConfig().note;
    if (lines.length === 0) {
      summary.innerHTML = '<p class="muted" style="margin:0">Belum ada produk di keranjang. Ringkasan akan muncul di sini.</p>';
      return;
    }
    summary.innerHTML = `<div class="row"><span>Jumlah barang</span><b>${totalItems} item</b></div>
      <div class="row"><span>Subtotal</span><b>${formatRp(cartTotal())}</b></div>
      <div class="row"><span>Total</span><b class="total">${formatRp(cartTotal())}</b></div>`;
  }

  function renderPaymentMethods() {
    const container = $('#payMethodOptions');
    if (!container) return;
    const methods = paymentConfig().methods;
    if (!methods.some((method) => method.id === state.paymentMethod)) {
      state.paymentMethod = methods[0] ? methods[0].id : 'transfer';
    }
    const signature = methods.map((method) => method.id).join('|');
    if (container.dataset.signature !== signature || !container.querySelector('input')) {
      container.dataset.signature = signature;
      container.innerHTML = methods.map((method) => `<label class="pay-method">
        <input type="radio" name="paymentMethod" value="${esc(method.id)}"${method.id === state.paymentMethod ? ' checked' : ''}>
        <span><b>${esc(method.label)}</b><small>${esc(method.description || '')}</small></span>
      </label>`).join('');
      return;
    }
    $$('input[name="paymentMethod"]', container).forEach((input) => {
      input.checked = input.value === state.paymentMethod;
    });
  }

  function renderDeliveryFields() {
    const select = $('#co-delivery');
    const field = $('#co-address-field');
    const input = $('#co-address');
    if (!select || !field || !input) return;
    const delivery = select.value === 'delivery';
    field.hidden = !delivery;
    input.required = delivery;
  }

  function transactionStatusPill(status) {
    const label = TX_STATUS_LABEL[status] || status || 'Menunggu';
    return `<span class="status-pill status-${esc(status || 'pending')}">${esc(label)}</span>`;
  }

  function transactionItemsHtml(transaction) {
    const items = transaction.items || [];
    if (!items.length) return '';
    return `<ul class="tx-items">${items.map((item) => (
      `<li>${esc(item.name)} × ${Number(item.quantity) || 0} — ${formatRp(item.subtotal)}</li>`
    )).join('')}</ul>`;
  }

  function waOrderLink(transaction) {
    const number = String((state.publicData && state.publicData.waNumber) || WA_FALLBACK).replace(/\D/g, '') || WA_FALLBACK;
    const text = encodeURIComponent(
      `Halo admin REKANA, saya membuat pesanan ${transaction.code} sebesar ${formatRp(transaction.total)} dengan metode ${transaction.paymentLabel || 'pembayaran manual'}. Mohon dibantu verifikasi pembayarannya.`,
    );
    return `https://wa.me/${number}?text=${text}`;
  }

  function renderOrderResult() {
    const panel = $('#orderResult');
    if (!panel) return;
    const data = state.lastOrder;
    if (!data || !data.transaction) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    const transaction = data.transaction;
    const instructions = (data.payment && data.payment.instructions) || [];
    panel.hidden = false;
    panel.innerHTML = `<div class="panel-head">
      <div>
        <span class="eyebrow">Kode pesanan</span>
        <h2 class="order-code">${esc(transaction.code)}</h2>
        <p class="muted" style="margin:4px 0 0">${formatDateTime(transaction.createdAt)}</p>
      </div>
      ${transactionStatusPill(transaction.status)}
    </div>
    <div class="cart-summary">
      <div class="row"><span>Metode</span><b>${esc(transaction.paymentLabel || 'Pembayaran manual')}</b></div>
      <div class="row"><span>Jumlah barang</span><b>${Number(transaction.itemCount) || 0} item</b></div>
      <div class="row"><span>Total</span><b class="total">${formatRp(transaction.total)}</b></div>
    </div>
    ${transactionItemsHtml(transaction)}
    <h3 style="margin:14px 0 0;font-size:1rem">Instruksi pembayaran</h3>
    <ol class="order-instructions">${instructions.map((text) => `<li>${esc(text)}</li>`).join('')}</ol>
    <div class="order-actions">
      <button class="btn btn-alt btn-sm" type="button" data-copy-code="${esc(transaction.code)}">Salin kode</button>
      <a class="btn btn-gold btn-sm" href="${esc(waOrderLink(transaction))}" target="_blank" rel="noopener noreferrer">Konfirmasi via WhatsApp</a>
    </div>`;
  }

  function renderLookupResult() {
    const panel = $('#lookupResult');
    if (!panel) return;
    const data = state.lookup;
    if (!data || !data.transaction) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    const transaction = data.transaction;
    const instructions = (data.payment && data.payment.instructions) || [];
    panel.hidden = false;
    panel.innerHTML = `<div class="panel-head" style="margin-bottom:8px">
      <div>
        <span class="eyebrow">Status pesanan</span>
        <h3 class="order-code" style="font-size:1rem">${esc(transaction.code)}</h3>
      </div>
      ${transactionStatusPill(transaction.status)}
    </div>
    <div class="cart-summary">
      <div class="row"><span>Pemesan</span><b>${esc(transaction.customerName || '—')}</b></div>
      <div class="row"><span>Metode</span><b>${esc(transaction.paymentLabel || 'Pembayaran manual')}</b></div>
      <div class="row"><span>Total</span><b>${formatRp(transaction.total)}</b></div>
      <div class="row"><span>Dibuat</span><b>${formatDateTime(transaction.createdAt)}</b></div>
    </div>
    ${transactionItemsHtml(transaction)}
    <ol class="order-instructions">${instructions.map((text) => `<li>${esc(text)}</li>`).join('')}</ol>
    ${transaction.adminNote ? `<p class="admin-note">Catatan admin: ${esc(transaction.adminNote)}</p>` : ''}
    <div class="order-actions">
      <a class="btn btn-alt btn-sm" href="${esc(waOrderLink(transaction))}" target="_blank" rel="noopener noreferrer">Hubungi admin</a>
    </div>`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Kode pesanan disalin ke papan klip.');
    } catch {
      toast(`Salin kode secara manual: ${text}`, 'error');
    }
  }

  function validateCheckout(payload) {
    const errors = {};
    if (payload.customerName.trim().length < 2) errors.customerName = 'Nama pemesan minimal 2 karakter.';
    const contact = payload.customerContact.trim();
    const validContact = /^[+()\d\s.-]{7,20}$/.test(contact) || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact);
    if (!validContact) errors.customerContact = 'Isi nomor WhatsApp atau alamat email yang valid.';
    if (!['pickup', 'delivery'].includes(payload.deliveryMethod)) errors.deliveryMethod = 'Pilih cara menerima pesanan.';
    if (payload.deliveryMethod === 'delivery' && payload.address.trim().length < 5) {
      errors.address = 'Alamat pengantaran wajib diisi minimal 5 karakter.';
    }
    if (payload.note.length > 300) errors.note = 'Catatan maksimal 300 karakter.';
    if (!paymentConfig().methods.some((method) => method.id === payload.paymentMethod)) {
      errors.paymentMethod = 'Pilih metode pembayaran yang tersedia.';
    }
    if (!payload.items.length) errors.items = 'Keranjang masih kosong.';
    return errors;
  }

  async function submitCheckout(event) {
    event.preventDefault();
    const form = $('#checkoutForm');
    const lines = cartLines();
    const payload = {
      customerName: $('#co-name').value.trim(),
      customerContact: $('#co-contact').value.trim(),
      deliveryMethod: $('#co-delivery').value,
      address: $('#co-address').value.trim(),
      note: $('#co-note').value.trim(),
      paymentMethod: state.paymentMethod,
      items: lines.map((line) => ({ id: line.product.id, quantity: line.quantity })),
    };
    const errors = validateCheckout(payload);
    if (Object.keys(errors).length) {
      applyFormErrors(form, errors, $('#checkoutError'), 'Periksa kembali data pesanan.');
      if (errors.items) toast('Keranjang masih kosong. Tambahkan produk dari katalog.', 'error');
      return;
    }

    const submit = $('#checkoutSubmit');
    state.checkoutBusy = true;
    busyButton(submit, true, 'Membuat pesanan…');
    try {
      const result = await api('/api/transactions', { method: 'POST', body: payload });
      state.lastOrder = { transaction: result.transaction, payment: result.payment };
      writeLS(LS.lastOrder, state.lastOrder);
      state.lookup = null;
      state.cart = [];
      removeLS(LS.cart);
      state.checkoutBusy = false;
      clearFormErrors(form, $('#checkoutError'));
      renderPayment();
      toast(result.message || 'Pesanan berhasil dibuat.');
      const panel = $('#orderResult');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (err.errors && Object.keys(err.errors).length) {
        applyFormErrors(form, err.errors, $('#checkoutError'), err.message);
      } else {
        const box = $('#checkoutError');
        if (box) box.textContent = err.message;
      }
      if (err.data && err.data.code === 'OUT_OF_STOCK') {
        await loadPublic({ silent: true });
      }
      toast(err.message, 'error');
    } finally {
      state.checkoutBusy = false;
      busyButton(submit, false);
      renderCart();
    }
  }

  async function submitLookup(event) {
    event.preventDefault();
    const form = $('#lookupForm');
    const code = $('#lookupCode').value.trim();
    const contact = $('#lookupContact').value.trim();
    const errors = {};
    if (!code) errors.code = 'Kode pesanan wajib diisi.';
    if (!contact) errors.contact = 'Kontak pemesan wajib diisi.';
    clearFormErrors(form, $('#lookupError'));
    if (Object.keys(errors).length) {
      applyFormErrors(form, errors, $('#lookupError'), 'Isi kode pesanan dan kontak.');
      return;
    }
    const submit = $('#lookupSubmit');
    busyButton(submit, true, 'Mencari…');
    try {
      const result = await api('/api/transactions/lookup', { method: 'POST', body: { code, contact } });
      state.lookup = { transaction: result.transaction, payment: result.payment };
      renderLookupResult();
      toast('Status pesanan ditemukan.');
    } catch (err) {
      state.lookup = null;
      renderLookupResult();
      if (err.errors && Object.keys(err.errors).length) {
        applyFormErrors(form, err.errors, $('#lookupError'), err.message);
      } else {
        const box = $('#lookupError');
        if (box) box.textContent = err.message;
      }
    } finally {
      busyButton(submit, false);
    }
  }

  // ---------------------------------------------------------------------------
  // Dashboard admin
  // ---------------------------------------------------------------------------

  const STATUS_LABEL = { pending: 'Menunggu', published: 'Terbit', rejected: 'Ditolak' };

  function renderDashboard() {
    const gate = $('#adminGate');
    const area = $('#adminArea');
    if (!gate || !area) return;
    const isAdmin = Boolean(state.admin);
    gate.hidden = isAdmin;
    area.hidden = !isAdmin;

    if (!isAdmin) {
      setText('#adminIdentity', '');
      return;
    }

    const identity = $('#adminIdentity');
    if (identity) {
      const name = state.admin.name || state.admin.username || 'Admin';
      identity.textContent = `${name}${state.admin.username ? ' · @' + state.admin.username : ''}`;
    }

    const data = state.adminData;
    if (!data) {
      setHtml('#stats', '<div class="empty" style="grid-column:1/-1"><strong>Memuat data admin…</strong><p>Mengambil data dari MySQL.</p></div>');
      setHtml('#catBars', '');
      setHtml('#dashSummary', '');
      setHtml('#warningAdminList', '<div class="empty"><strong>Memuat peringatan…</strong></div>');
      setHtml('#moderationList', '<div class="empty"><strong>Memuat laporan…</strong></div>');
      setHtml('#productRows', '<tr><td colspan="6">Memuat data produk…</td></tr>');
      setHtml('#categoryList', '<div class="empty"><strong>Memuat kategori…</strong></div>');
      setHtml('#transactionAdminList', '<div class="empty"><strong>Memuat transaksi…</strong></div>');
      setHtml('#weatherEditor', '<div class="empty"><strong>Memuat prakiraan…</strong></div>');
      setText('#tabWarnCount', '0');
      setText('#tabIncidentCount', '0');
      setText('#tabTxCount', '0');
      setText('#incidentAdminCount', '0 laporan');
      setText('#txAdminCount', '0 transaksi');
      applyAdminTab();
      return;
    }

    const summary = data.summary || {};
    renderStats(summary);
    renderCatBars(summary);
    renderDashSummary(data);
    renderWeatherEditor(data);
    renderWarningsAdmin(data);
    renderModeration(data);
    renderProductsAdmin(data);
    renderCategoriesAdmin(data);
    renderTransactionsAdmin(data);
    setText('#tabWarnCount', String(summary.activeWarnings || 0));
    setText('#tabIncidentCount', String(summary.pendingIncidents || 0));
    setText('#tabTxCount', String(summary.pendingTransactions || 0));
    applyAdminTab();
  }

  function applyAdminTab() {
    $$('.admin-tabs [role="tab"]').forEach((btn) => {
      const on = btn.dataset.tab === state.activeTab;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
    });
    $$('.admin-tab').forEach((panel) => {
      panel.hidden = panel.id !== `tab-${state.activeTab}`;
    });
  }

  function setAdminTab(tab) {
    if (!tab) return;
    state.activeTab = tab;
    applyAdminTab();
    if (tab === 'cuaca' && state.adminData) renderWeatherEditor(state.adminData);
  }

  function renderStats(summary) {
    const items = [
      { label: 'Total produk', value: Number(summary.totalProducts) || 0 },
      { label: 'Total stok', value: Number(summary.totalStock) || 0 },
      { label: 'Produk unggulan', value: Number(summary.featuredProducts) || 0 },
      { label: 'Stok ≤ 5 / habis', value: Number(summary.lowStockProducts) || 0, alert: true },
      { label: 'Laporan menunggu', value: Number(summary.pendingIncidents) || 0, alert: Number(summary.pendingIncidents) > 0 },
      { label: 'Transaksi menunggu', value: Number(summary.pendingTransactions) || 0, alert: Number(summary.pendingTransactions) > 0 },
      { label: 'Peringatan aktif', value: Number(summary.activeWarnings) || 0 },
    ];
    setHtml('#stats', items.map((item) => `<div class="stat${item.alert ? ' alert' : ''}"><b>${item.value}</b><span>${esc(item.label)}</span></div>`).join(''));
  }

  function renderCatBars(summary) {
    const categories = summary.categories || [];
    const max = Math.max(1, ...categories.map((c) => Number(c.count) || 0));
    setHtml('#catBars', categories.map((c) => {
      const count = Number(c.count) || 0;
      return `<div class="bars-row">
        <span title="${esc(c.name)}">${esc(c.name)}</span>
        <div class="bars-track"><i style="width:${Math.round((count / max) * 100)}%;background:${safeColor(c.color)}"></i></div>
        <b>${count}</b>
      </div>`;
    }).join('') || '<div class="empty"><strong>Belum ada kategori</strong></div>');
  }

  function renderDashSummary(data) {
    const summary = data.summary || {};
    const today = summary.todayWeather || getTodayWeather(data);
    const weatherText = today
      ? `${esc(today.condition)} · ${today.tempMin}–${today.tempMax} °C · ${esc(today.alertLevel)}`
      : 'Belum diisi admin';
    const container = $('#dashSummary');
    if (!container) return;
    container.innerHTML = `<div class="dash-facts">
      <div><span>Cuaca hari ini</span><b>${weatherText}</b></div>
      <div><span>Kejadian terbit</span><b>${Number(summary.publishedIncidents) || 0}</b></div>
      <div><span>Kejadian hari ini</span><b>${Number(summary.incidentsToday) || 0}</b></div>
      <div><span>Laporan menunggu</span><b>${Number(summary.pendingIncidents) || 0}</b></div>
      <div><span>Transaksi menunggu</span><b>${Number(summary.pendingTransactions) || 0}</b></div>
      <div><span>Pendapatan terverifikasi</span><b>${formatRp(summary.verifiedRevenue)}</b></div>
      <div><span>Peringatan aktif</span><b>${Number(summary.activeWarnings) || 0}</b></div>
    </div>
    <div class="form-actions" style="justify-content:flex-start">
      <button class="btn btn-alt btn-sm" type="button" data-goto-tab="cuaca">Ubah cuaca</button>
      <button class="btn btn-alt btn-sm" type="button" data-goto-tab="kejadian">Periksa laporan</button>
      <button class="btn btn-alt btn-sm" type="button" data-goto-tab="transaksi">Verifikasi transaksi</button>
      <button class="btn btn-alt btn-sm" type="button" data-goto-tab="peringatan">Kelola peringatan</button>
    </div>`;
  }

  function weatherSignature(weather) {
    return JSON.stringify((weather || []).map((w) => [
      w.date, w.condition, w.tempMin, w.tempMax, w.rainChance, w.alertLevel,
    ]));
  }

  function renderWeatherEditor(data) {
    const editor = $('#weatherEditor');
    if (!editor) return;
    const weather = data.weather || [];
    const signature = weatherSignature(weather);
    if (editor.dataset.signature === signature && editor.querySelector('.weather-row')) return;
    editor.dataset.signature = signature;
    if (weather.length === 0) {
      editor.innerHTML = '<div class="empty"><strong>Belum ada prakiraan</strong><p>Jalankan <code>npm run db:init</code> atau tambahkan data melalui MySQL.</p></div>';
      return;
    }
    editor.innerHTML = `<div class="weather-editor-head">
      <span>Tanggal</span><span>Kondisi</span><span>Suhu min</span><span>Suhu maks</span><span>Hujan %</span><span>Kewaspadaan</span>
    </div>` + weather.map((w) => {
      const isToday = w.date === (data.today || todayLocal());
      return `<div class="weather-row" data-date="${esc(w.date)}">
        <div class="w-date">${esc(formatWeekday(w.date, 'short'))}${isToday ? ' <span class="badge badge-success" style="padding:0 5px;font-size:.6rem">Kini</span>' : ''}<small>${formatDate(w.date)}</small></div>
        <input data-field="condition" maxlength="50" value="${esc(w.condition)}" aria-label="Kondisi cuaca ${formatDate(w.date)}">
        <div class="w-temp"><small>Min</small><input data-field="tempMin" type="number" min="-20" max="60" value="${Number(w.tempMin)}" aria-label="Suhu minimum ${formatDate(w.date)}"></div>
        <div class="w-temp"><small>Maks</small><input data-field="tempMax" type="number" min="-20" max="60" value="${Number(w.tempMax)}" aria-label="Suhu maksimum ${formatDate(w.date)}"></div>
        <div class="w-temp"><small>%</small><input data-field="rainChance" type="number" min="0" max="100" value="${Number(w.rainChance)}" aria-label="Peluang hujan ${formatDate(w.date)}"></div>
        <select data-field="alertLevel" class="w-level" aria-label="Kewaspadaan ${formatDate(w.date)}">
          ${['Normal', 'Waspada', 'Siaga'].map((level) => `<option${level === w.alertLevel ? ' selected' : ''}>${level}</option>`).join('')}
        </select>
      </div>`;
    }).join('');
  }

  function renderWarningsAdmin(data) {
    const list = $('#warningAdminList');
    if (!list) return;
    const warnings = data.allWarnings || [];
    if (warnings.length === 0) {
      list.innerHTML = '<div class="empty"><strong>Belum ada peringatan</strong><p>Tambahkan peringatan agar tampil di halaman publik saat aktif dan dalam rentang waktu.</p></div>';
      return;
    }
    list.innerHTML = warnings.map((w) => {
      const end = w.endsAt ? formatDateTime(w.endsAt) : 'sampai dicabut';
      const activeBadge = w.active
        ? '<span class="badge badge-success">Aktif</span>'
        : '<span class="badge badge-muted">Nonaktif</span>';
      return `<article class="warning-admin-card ${warningLevelClass(w.level)}">
        <div class="warning-admin-head">
          <div>
            <span class="level-pill">${esc(w.level)}</span>
            <h3>${esc(w.title)}</h3>
          </div>
          ${activeBadge}
        </div>
        <p>${esc(w.message)}</p>
        <div class="warning-meta">
          <span>Wilayah: ${esc(w.area)}</span>
          <span>Berlaku: ${formatDateTime(w.startsAt)} — ${end}</span>
        </div>
        <div class="warning-admin-actions">
          <button class="btn btn-alt btn-sm" type="button" data-action="edit-warning" data-id="${Number(w.id)}">Ubah</button>
          <button class="btn btn-alt btn-sm" type="button" data-action="toggle-warning" data-id="${Number(w.id)}">${w.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
          <button class="btn btn-danger btn-sm" type="button" data-action="delete-warning" data-id="${Number(w.id)}">Hapus</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderModeration(data) {
    const list = $('#moderationList');
    const count = $('#incidentAdminCount');
    if (!list) return;
    const all = data.allIncidents || [];
    const query = state.mod.q.toLowerCase().trim();
    const filtered = all.filter((incident) => {
      const statusMatch = state.mod.status === 'all' || incident.status === state.mod.status;
      const haystack = `${incident.title} ${incident.summary} ${incident.location} ${incident.type} ${incident.reporterName || ''}`.toLowerCase();
      return statusMatch && (!query || haystack.includes(query));
    });
    if (count) count.textContent = `${filtered.length} laporan`;

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty"><strong>Tidak ada laporan yang cocok</strong><p>Ubah filter status atau kata kunci pencarian.</p></div>';
      return;
    }

    list.innerHTML = filtered.map((incident) => {
      const status = incident.status || 'pending';
      const label = STATUS_LABEL[status] || status;
      const reporter = incident.reporterName || 'Anonim';
      const contact = incident.reporterContact ? ` · ${incident.reporterContact}` : '';
      const actions = [];
      if (status !== 'published') actions.push(`<button class="btn btn-sm" type="button" data-action="status" data-status="published" data-id="${Number(incident.id)}">Publikasikan</button>`);
      if (status !== 'pending') actions.push(`<button class="btn btn-alt btn-sm" type="button" data-action="status" data-status="pending" data-id="${Number(incident.id)}">Sembunyikan</button>`);
      if (status !== 'rejected') actions.push(`<button class="btn btn-alt btn-sm" type="button" data-action="status" data-status="rejected" data-id="${Number(incident.id)}">Tolak</button>`);
      actions.push(`<button class="btn btn-danger btn-sm" type="button" data-action="delete-incident" data-id="${Number(incident.id)}">Hapus</button>`);
      return `<article class="mod-card is-${esc(status)}">
        <div class="mod-head">
          <div>
            <span class="status-pill status-${esc(status)}">${esc(label)}</span>
            <h3>${esc(incident.title)}</h3>
          </div>
          <span class="type-pill">${esc(incident.type || 'Lainnya')}</span>
        </div>
        <p>${esc(incident.summary)}</p>
        <div class="mod-meta">
          <span>Lokasi: ${esc(incident.location)}</span>
          <span>Waktu: ${formatDateTime(incident.occurredAt)}</span>
          <span>Pelapor: ${esc(reporter)}${esc(contact)}</span>
        </div>
        ${incident.adminNote ? `<div class="admin-note">Catatan admin: ${esc(incident.adminNote)}</div>` : ''}
        <div class="mod-actions">${actions.join('')}</div>
      </article>`;
    }).join('');
  }

  function renderProductsAdmin(data) {
    const tbody = $('#productRows');
    if (!tbody) return;
    const products = data.products || [];
    if (products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">Belum ada produk. Pilih Tambah produk untuk memulai.</td></tr>';
      return;
    }
    tbody.innerHTML = products.map((p) => {
      const stock = stockInfo(p.stock);
      return `<tr>
        <td>
          <div class="prod-cell">
            <img data-product-image="${esc(p.id)}" src="${esc(imageSrc(p))}" alt="" loading="lazy">
            <div><b>${esc(p.name)}</b><small>${esc(p.id)}</small></div>
          </div>
        </td>
        <td><span class="color-dot" style="background:${safeColor(p.categoryColor)}"></span> ${esc(p.category)}</td>
        <td>${formatRp(p.price)}</td>
        <td><span class="stock ${stock.className}" style="font-size:.72rem">${stock.label}: ${Number(p.stock) || 0}</span></td>
        <td>${p.featured ? 'Ya' : 'Tidak'}</td>
        <td><div class="row-actions">
          <button class="btn btn-alt btn-sm" type="button" data-action="edit-product" data-id="${esc(p.id)}">Ubah</button>
          <button class="btn btn-danger btn-sm" type="button" data-action="delete-product" data-id="${esc(p.id)}">Hapus</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  function renderCategoriesAdmin(data) {
    const list = $('#categoryList');
    const count = $('#categoryCount');
    if (!list) return;
    const categories = data.categories || [];
    if (count) count.textContent = String(categories.length);
    if (categories.length === 0) {
      list.innerHTML = '<div class="empty"><strong>Belum ada kategori</strong></div>';
      return;
    }
    list.innerHTML = categories.map((category) => `<div class="category-item">
      <span class="color-dot" style="background:${safeColor(category.color)}"></span>
      <b>${esc(category.name)}</b>
      <span class="count-pill">${Number(category.productCount) || 0} produk</span>
      <div class="row-actions">
        <button class="btn btn-alt btn-sm" type="button" data-action="edit-category" data-id="${Number(category.id)}">Ubah</button>
        <button class="btn btn-danger btn-sm" type="button" data-action="delete-category" data-id="${Number(category.id)}">Hapus</button>
      </div>
    </div>`).join('');
  }

  // ---------------------------------------------------------------------------
  // Transaksi admin
  // ---------------------------------------------------------------------------

  function transactionDeliveryLabel(transaction) {
    if (transaction.deliveryMethod === 'delivery') {
      return transaction.address ? `Diantar: ${transaction.address}` : 'Diantar ke alamat';
    }
    return 'Ambil di posko';
  }

  function renderTransactionsAdmin(data) {
    const list = $('#transactionAdminList');
    const count = $('#txAdminCount');
    if (!list) return;
    const all = data.transactions || [];
    const query = state.tx.q.toLowerCase().trim();
    const filtered = all.filter((transaction) => {
      const statusMatch = state.tx.status === 'all' || transaction.status === state.tx.status;
      const itemNames = (transaction.items || []).map((item) => item.name).join(' ');
      const haystack = `${transaction.code} ${transaction.customerName} ${transaction.customerContact} ${transaction.paymentLabel} ${itemNames}`.toLowerCase();
      return statusMatch && (!query || haystack.includes(query));
    });
    if (count) count.textContent = `${filtered.length} transaksi`;

    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty"><strong>Tidak ada transaksi yang cocok</strong><p>Ubah filter status atau kata kunci pencarian.</p></div>';
      return;
    }

    list.innerHTML = filtered.map((transaction) => {
      const status = transaction.status;
      const actions = [];
      if (status === 'pending') {
        actions.push(`<button class="btn btn-sm" type="button" data-action="verify-tx" data-id="${Number(transaction.id)}">Verifikasi</button>`);
        actions.push(`<button class="btn btn-alt btn-sm" type="button" data-action="cancel-tx" data-id="${Number(transaction.id)}">Batalkan</button>`);
      } else if (status === 'verified') {
        actions.push(`<button class="btn btn-alt btn-sm" type="button" data-action="cancel-tx" data-id="${Number(transaction.id)}">Batalkan</button>`);
      } else if (status === 'cancelled') {
        actions.push(`<button class="btn btn-danger btn-sm" type="button" data-action="delete-tx" data-id="${Number(transaction.id)}">Hapus</button>`);
      }

      const timestamps = [];
      if (transaction.createdAt) timestamps.push(`Dibuat ${formatDateTime(transaction.createdAt)}`);
      if (transaction.verifiedAt) timestamps.push(`Diverifikasi ${formatDateTime(transaction.verifiedAt)}`);
      if (transaction.cancelledAt) timestamps.push(`Dibatalkan ${formatDateTime(transaction.cancelledAt)}`);

      return `<article class="tx-card is-${esc(status)}">
        <div class="tx-head">
          <div>
            ${transactionStatusPill(status)}
            <h3>${esc(transaction.code)}</h3>
            <small>${esc(timestamps.join(' · '))}</small>
          </div>
          <b class="tx-total">${formatRp(transaction.total)}</b>
        </div>
        <div class="tx-meta">
          <span>Pemesan: ${esc(transaction.customerName || '—')}</span>
          <span>Kontak: ${esc(transaction.customerContact || '—')}</span>
          <span>Metode: ${esc(transaction.paymentLabel || 'Pembayaran manual')}</span>
          <span>${esc(transactionDeliveryLabel(transaction))}</span>
        </div>
        ${transactionItemsHtml(transaction)}
        ${transaction.note ? `<div class="admin-note">Catatan pemesan: ${esc(transaction.note)}</div>` : ''}
        ${transaction.adminNote ? `<div class="admin-note">Catatan admin: ${esc(transaction.adminNote)}</div>` : ''}
        <div class="tx-actions">${actions.join('')}</div>
      </article>`;
    }).join('');
  }

  function openTransactionDialog(id, status) {
    if (!state.adminData) return;
    const transaction = (state.adminData.transactions || []).find((item) => Number(item.id) === Number(id));
    if (!transaction) return;
    state.editingTransaction = transaction;
    $('#tx-id').value = String(transaction.id);
    $('#tx-action-status').value = status;
    $('#transactionDialogTitle').textContent = status === 'verified' ? 'Verifikasi pembayaran' : 'Batalkan transaksi';
    $('#transactionDialogBody').innerHTML = `<div class="cart-summary">
      <div class="row"><span>Kode</span><b>${esc(transaction.code)}</b></div>
      <div class="row"><span>Status saat ini</span><b>${TX_STATUS_LABEL[transaction.status] || transaction.status}</b></div>
      <div class="row"><span>Pemesan</span><b>${esc(transaction.customerName || '—')}</b></div>
      <div class="row"><span>Kontak</span><b>${esc(transaction.customerContact || '—')}</b></div>
      <div class="row"><span>Metode</span><b>${esc(transaction.paymentLabel || 'Pembayaran manual')}</b></div>
      <div class="row"><span>Total</span><b class="total">${formatRp(transaction.total)}</b></div>
    </div>
    ${transactionItemsHtml(transaction)}
    <div class="tx-meta"><span>${esc(transactionDeliveryLabel(transaction))}</span></div>`;
    $('#tx-admin-note').value = transaction.adminNote || '';
    const submit = $('#transactionSubmit');
    submit.textContent = status === 'verified' ? 'Ya, verifikasi' : 'Ya, batalkan';
    submit.className = status === 'verified' ? 'btn' : 'btn btn-danger';
    delete submit.dataset.normalLabel;
    clearFormErrors($('#transactionForm'), $('#transactionError'));
    openDialog($('#transactionDialog'));
  }

  async function submitTransaction(event) {
    event.preventDefault();
    const id = $('#tx-id').value;
    const status = $('#tx-action-status').value;
    if (!id || !['verified', 'cancelled'].includes(status)) return;
    const submit = $('#transactionSubmit');
    busyButton(submit, true, 'Memproses…');
    try {
      const result = await api(`/api/admin/transactions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        auth: true,
        body: { status, adminNote: $('#tx-admin-note').value.trim() },
      });
      closeDialog($('#transactionDialog'));
      applyAdminPayload(result.data);
      toast(result.message || 'Transaksi diperbarui.');
    } catch (err) {
      if (err.status === 401) return;
      const box = $('#transactionError');
      if (box) box.textContent = err.message;
      toast(err.message, 'error');
    } finally {
      busyButton(submit, false);
    }
  }

  async function deleteTransaction(id) {
    const transaction = (state.adminData && state.adminData.transactions || [])
      .find((item) => Number(item.id) === Number(id));
    if (!transaction) return;
    if (!(await confirmAction(`Hapus transaksi ${transaction.code}? Stok yang pernah dikurangi akan dikembalikan.`, 'Hapus transaksi'))) return;
    try {
      const result = await api(`/api/admin/transactions/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
      applyAdminPayload(result.data);
      toast(result.message || 'Transaksi dihapus.');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Form produk
  // ---------------------------------------------------------------------------

  function validateProduct(payload) {
    const errors = {};
    const name = String(payload.name || '').trim();
    if (name.length < 2 || name.length > 60) errors.name = 'Nama produk harus 2 sampai 60 karakter.';
    const categoryId = Number(payload.categoryId);
    if (!Number.isInteger(categoryId) || categoryId <= 0) errors.categoryId = 'Pilih kategori produk.';
    const price = Number(payload.price);
    if (payload.price === '' || !Number.isInteger(price) || price < 0) errors.price = 'Harga harus bilangan bulat 0 atau lebih.';
    const stock = Number(payload.stock);
    if (payload.stock === '' || !Number.isInteger(stock) || stock < 0) errors.stock = 'Stok harus bilangan bulat 0 atau lebih.';
    if (String(payload.description || '').length > 300) errors.description = 'Deskripsi maksimal 300 karakter.';
    if (payload.imageUrl && !/^(https?:\/\/|assets\/|\/(?!\/))/i.test(payload.imageUrl)) {
      errors.imageUrl = 'Alamat gambar harus diawali https://, assets/, atau /.';
    }
    return errors;
  }

  function openProductDialog(id) {
    if (!state.adminData) {
      toast('Data admin belum siap. Coba lagi sebentar.', 'error');
      return;
    }
    const form = $('#productForm');
    if (!form) return;
    state.editingProduct = id || null;
    form.reset();
    clearFormErrors(form, $('#productError'));
    const select = $('#p-category');
    select.innerHTML = '<option value="">Pilih kategori</option>' + (state.adminData.categories || [])
      .map((c) => `<option value="${Number(c.id)}">${esc(c.name)}</option>`).join('');

    const product = id ? (state.adminData.products || []).find((p) => p.id === id) : null;
    $('#p-id').value = product ? product.id : '';
    $('#p-name').value = product ? product.name : '';
    $('#p-category').value = product ? String(product.categoryId) : '';
    $('#p-price').value = product ? String(product.price) : '';
    $('#p-stock').value = product ? String(product.stock) : '';
    $('#p-description').value = product ? product.description : '';
    $('#p-imageUrl').value = product ? product.imageUrl : '';
    $('#p-featured').checked = Boolean(product && product.featured);
    $('#productDialogTitle').textContent = product ? 'Ubah produk' : 'Tambah produk';
    const submit = $('#productSubmit');
    submit.textContent = product ? 'Simpan perubahan' : 'Simpan produk';
    delete submit.dataset.normalLabel;
    openDialog($('#productDialog'));
    window.setTimeout(() => $('#p-name').focus(), 60);
  }

  async function submitProduct(event) {
    event.preventDefault();
    const form = $('#productForm');
    const payload = {
      name: $('#p-name').value.trim(),
      categoryId: $('#p-category').value,
      price: $('#p-price').value,
      stock: $('#p-stock').value,
      description: $('#p-description').value.trim(),
      imageUrl: $('#p-imageUrl').value.trim(),
      featured: $('#p-featured').checked,
    };
    const errors = validateProduct(payload);
    if (Object.keys(errors).length) {
      applyFormErrors(form, errors, $('#productError'), 'Periksa kembali data produk.');
      return;
    }
    const id = $('#p-id').value;
    const submit = $('#productSubmit');
    busyButton(submit, true);
    try {
      const result = await api(id ? `/api/admin/products/${encodeURIComponent(id)}` : '/api/admin/products', {
        method: id ? 'PUT' : 'POST',
        auth: true,
        body: {
          ...payload,
          categoryId: Number(payload.categoryId),
          price: Number(payload.price),
          stock: Number(payload.stock),
        },
      });
      closeDialog($('#productDialog'));
      applyAdminPayload(result.data);
      toast(result.message || (id ? 'Produk diperbarui.' : 'Produk ditambahkan.'));
    } catch (err) {
      if (err.status === 401) return;
      applyFormErrors(form, err.errors, $('#productError'), err.message);
      if (!err.errors || Object.keys(err.errors).length === 0) toast(err.message, 'error');
    } finally {
      busyButton(submit, false);
    }
  }

  async function deleteProduct(id) {
    const product = (state.adminData && state.adminData.products || []).find((p) => p.id === id);
    if (!product) return;
    if (!(await confirmAction(`Hapus produk “${product.name}” dari MySQL?`, 'Hapus produk'))) return;
    try {
      const result = await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
      applyAdminPayload(result.data);
      toast(result.message || 'Produk dihapus.');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Form peringatan bencana
  // ---------------------------------------------------------------------------

  function validateWarning(payload) {
    const errors = {};
    if (payload.title.trim().length < 3 || payload.title.trim().length > 120) errors.title = 'Judul harus 3 sampai 120 karakter.';
    if (payload.message.trim().length < 5 || payload.message.trim().length > 500) errors.message = 'Isi peringatan harus 5 sampai 500 karakter.';
    if (!payload.area.trim() || payload.area.trim().length < 2) errors.area = 'Wilayah harus 2 sampai 100 karakter.';
    if (!['Waspada', 'Siaga', 'Awas'].includes(payload.level)) errors.level = 'Level tidak valid.';
    const starts = payload.startsAt ? toDate(payload.startsAt) : null;
    if (!starts) errors.startsAt = 'Waktu mulai wajib diisi.';
    if (payload.endsAt) {
      const ends = toDate(payload.endsAt);
      if (!ends) errors.endsAt = 'Waktu selesai tidak valid.';
      else if (starts && ends <= starts) errors.endsAt = 'Waktu selesai harus setelah waktu mulai.';
    }
    return errors;
  }

  function openWarningDialog(id) {
    if (!state.adminData) {
      toast('Data admin belum siap. Coba lagi sebentar.', 'error');
      return;
    }
    const form = $('#warningForm');
    if (!form) return;
    state.editingWarning = id || null;
    form.reset();
    clearFormErrors(form, $('#warningError'));
    const warning = id ? (state.adminData.allWarnings || []).find((w) => Number(w.id) === Number(id)) : null;
    $('#w-id').value = warning ? String(warning.id) : '';
    $('#w-title').value = warning ? warning.title : '';
    $('#w-level').value = warning ? warning.level : 'Waspada';
    $('#w-area').value = warning ? warning.area : '';
    $('#w-message').value = warning ? warning.message : '';
    $('#w-startsAt').value = warning ? toInputValue(warning.startsAt) : nowLocalInput();
    $('#w-endsAt').value = warning && warning.endsAt ? toInputValue(warning.endsAt) : '';
    $('#w-active').checked = warning ? Boolean(warning.active) : true;
    $('#warningDialogTitle').textContent = warning ? 'Ubah peringatan' : 'Tambah peringatan';
    const submit = $('#warningSubmit');
    submit.textContent = warning ? 'Simpan perubahan' : 'Simpan peringatan';
    delete submit.dataset.normalLabel;
    openDialog($('#warningDialog'));
    window.setTimeout(() => $('#w-title').focus(), 60);
  }

  async function submitWarning(event) {
    event.preventDefault();
    const form = $('#warningForm');
    const payload = {
      title: $('#w-title').value.trim(),
      level: $('#w-level').value,
      area: $('#w-area').value.trim(),
      message: $('#w-message').value.trim(),
      startsAt: $('#w-startsAt').value,
      endsAt: $('#w-endsAt').value,
      active: $('#w-active').checked,
    };
    const errors = validateWarning(payload);
    if (Object.keys(errors).length) {
      applyFormErrors(form, errors, $('#warningError'), 'Periksa kembali peringatan.');
      return;
    }
    const id = $('#w-id').value;
    const submit = $('#warningSubmit');
    busyButton(submit, true);
    try {
      const result = await api(id ? `/api/admin/warnings/${encodeURIComponent(id)}` : '/api/admin/warnings', {
        method: id ? 'PUT' : 'POST',
        auth: true,
        body: payload,
      });
      closeDialog($('#warningDialog'));
      applyAdminPayload(result.data);
      toast(result.message || (id ? 'Peringatan diperbarui.' : 'Peringatan ditambahkan.'));
    } catch (err) {
      if (err.status === 401) return;
      applyFormErrors(form, err.errors, $('#warningError'), err.message);
      if (!err.errors || Object.keys(err.errors).length === 0) toast(err.message, 'error');
    } finally {
      busyButton(submit, false);
    }
  }

  async function toggleWarning(id) {
    const warning = (state.adminData && state.adminData.allWarnings || []).find((w) => Number(w.id) === Number(id));
    if (!warning) return;
    try {
      const result = await api(`/api/admin/warnings/${encodeURIComponent(id)}`, {
        method: 'PUT',
        auth: true,
        body: {
          title: warning.title,
          message: warning.message,
          level: warning.level,
          area: warning.area,
          startsAt: warning.startsAt,
          endsAt: warning.endsAt,
          active: !warning.active,
        },
      });
      applyAdminPayload(result.data);
      toast(result.message || 'Status peringatan diperbarui.');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  async function deleteWarning(id) {
    const warning = (state.adminData && state.adminData.allWarnings || []).find((w) => Number(w.id) === Number(id));
    if (!warning) return;
    if (!(await confirmAction(`Hapus peringatan “${warning.title}”?`, 'Hapus peringatan'))) return;
    try {
      const result = await api(`/api/admin/warnings/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
      applyAdminPayload(result.data);
      toast(result.message || 'Peringatan dihapus.');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Moderasi kejadian
  // ---------------------------------------------------------------------------

  async function setIncidentStatus(id, status, btn) {
    if (btn) busyButton(btn, true, 'Memproses…');
    try {
      const result = await api(`/api/admin/incidents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        auth: true,
        body: { status },
      });
      applyAdminPayload(result.data);
      toast(result.message || 'Status kejadian diperbarui.');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    } finally {
      if (btn) busyButton(btn, false);
    }
  }

  async function deleteIncident(id) {
    const incident = (state.adminData && state.adminData.allIncidents || []).find((i) => Number(i.id) === Number(id));
    if (!incident) return;
    if (!(await confirmAction(`Hapus laporan “${incident.title}” dari MySQL?`, 'Hapus laporan'))) return;
    try {
      const result = await api(`/api/admin/incidents/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
      applyAdminPayload(result.data);
      toast(result.message || 'Laporan dihapus.');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Cuaca admin
  // ---------------------------------------------------------------------------

  function collectWeatherRows() {
    const editor = $('#weatherEditor');
    if (!editor) return [];
    return $$('.weather-row', editor).map((row) => ({
      date: row.dataset.date,
      condition: $('[data-field="condition"]', row).value.trim(),
      tempMin: $('[data-field="tempMin"]', row).value,
      tempMax: $('[data-field="tempMax"]', row).value,
      rainChance: $('[data-field="rainChance"]', row).value,
      alertLevel: $('[data-field="alertLevel"]', row).value,
    }));
  }

  function validateWeatherRows(rows) {
    const messages = [];
    rows.forEach((row) => {
      const label = formatDate(row.date);
      if (row.condition.length < 2) messages.push(`${label}: kondisi cuaca wajib diisi.`);
      const min = Number(row.tempMin);
      const max = Number(row.tempMax);
      const rain = Number(row.rainChance);
      if (row.tempMin === '' || !Number.isInteger(min) || min < -20 || min > 60) messages.push(`${label}: suhu minimum harus -20 sampai 60.`);
      if (row.tempMax === '' || !Number.isInteger(max) || max < -20 || max > 60) messages.push(`${label}: suhu maksimum harus -20 sampai 60.`);
      if (Number.isInteger(min) && Number.isInteger(max) && min > max) messages.push(`${label}: suhu minimum tidak boleh lebih besar dari maksimum.`);
      if (row.rainChance === '' || !Number.isInteger(rain) || rain < 0 || rain > 100) messages.push(`${label}: peluang hujan harus 0 sampai 100.`);
      if (!['Normal', 'Waspada', 'Siaga'].includes(row.alertLevel)) messages.push(`${label}: level kewaspadaan tidak valid.`);
    });
    return messages;
  }

  async function submitWeather(event) {
    event.preventDefault();
    const box = $('#weatherError');
    const rows = collectWeatherRows();
    const messages = validateWeatherRows(rows);
    if (messages.length) {
      if (box) box.textContent = messages.join(' ');
      return;
    }
    if (box) box.textContent = '';
    const button = $('#weatherForm button[type="submit"]');
    busyButton(button, true);
    try {
      const result = await api('/api/admin/weather', {
        method: 'PUT',
        auth: true,
        body: {
          forecasts: rows.map((row) => ({
            date: row.date,
            condition: row.condition,
            tempMin: Number(row.tempMin),
            tempMax: Number(row.tempMax),
            rainChance: Number(row.rainChance),
            alertLevel: row.alertLevel,
          })),
        },
      });
      applyAdminPayload(result.data);
      toast(result.message || 'Prakiraan cuaca disimpan ke MySQL.');
    } catch (err) {
      if (err.status === 401) return;
      const details = err.errors && Object.keys(err.errors).length
        ? Object.values(err.errors).join(' ')
        : err.message;
      if (box) box.textContent = details;
      toast(err.message, 'error');
    } finally {
      busyButton(button, false);
    }
  }

  // ---------------------------------------------------------------------------
  // Kategori
  // ---------------------------------------------------------------------------

  function resetCategoryForm() {
    state.editingCategory = null;
    const form = $('#categoryForm');
    if (form) form.reset();
    $('#c-color').value = '#22385a';
    $('#categoryFormTitle').textContent = 'Tambah kategori';
    const submit = $('#categorySubmit');
    submit.textContent = 'Tambah kategori';
    delete submit.dataset.normalLabel;
    $('#cancelCategoryEdit').hidden = true;
    clearFormErrors(form, $('#categoryError'));
  }

  function startEditCategory(id) {
    if (!state.adminData) return;
    const category = (state.adminData.categories || []).find((c) => Number(c.id) === Number(id));
    if (!category) return;
    state.editingCategory = category;
    $('#c-name').value = category.name;
    $('#c-color').value = safeColor(category.color);
    $('#categoryFormTitle').textContent = 'Ubah kategori';
    const submit = $('#categorySubmit');
    submit.textContent = 'Simpan perubahan';
    delete submit.dataset.normalLabel;
    $('#cancelCategoryEdit').hidden = false;
    clearFormErrors($('#categoryForm'), $('#categoryError'));
    $('#c-name').focus();
    $('#categoryForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submitCategory(event) {
    event.preventDefault();
    const form = $('#categoryForm');
    const payload = {
      name: $('#c-name').value.trim(),
      color: $('#c-color').value,
    };
    const errors = {};
    if (payload.name.length < 2 || payload.name.length > 50) errors.name = 'Nama kategori harus 2 sampai 50 karakter.';
    if (!/^#[0-9a-f]{6}$/i.test(payload.color)) errors.color = 'Warna harus format #RRGGBB.';
    if (Object.keys(errors).length) {
      applyFormErrors(form, errors, $('#categoryError'), 'Periksa kembali data kategori.');
      return;
    }
    const editing = state.editingCategory;
    const submit = $('#categorySubmit');
    busyButton(submit, true);
    try {
      const result = await api(editing ? `/api/admin/categories/${Number(editing.id)}` : '/api/admin/categories', {
        method: editing ? 'PUT' : 'POST',
        auth: true,
        body: payload,
      });
      applyAdminPayload(result.data);
      resetCategoryForm();
      toast(result.message || (editing ? 'Kategori diperbarui.' : 'Kategori ditambahkan.'));
    } catch (err) {
      if (err.status === 401) return;
      applyFormErrors(form, err.errors, $('#categoryError'), err.message);
      if (!err.errors || Object.keys(err.errors).length === 0) toast(err.message, 'error');
    } finally {
      busyButton(submit, false);
    }
  }

  async function deleteCategory(id) {
    if (!state.adminData) return;
    const category = (state.adminData.categories || []).find((c) => Number(c.id) === Number(id));
    if (!category) return;
    if (!(await confirmAction(`Hapus kategori “${category.name}”? Kategori yang masih dipakai produk akan ditolak server.`, 'Hapus kategori'))) return;
    try {
      const result = await api(`/api/admin/categories/${Number(id)}`, { method: 'DELETE', auth: true });
      if (state.catalog.category === category.name) state.catalog.category = 'Semua';
      if (state.editingCategory && Number(state.editingCategory.id) === Number(id)) resetCategoryForm();
      applyAdminPayload(result.data);
      toast(result.message || 'Kategori dihapus.');
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Laporan masyarakat dan login
  // ---------------------------------------------------------------------------

  async function submitReport(event) {
    event.preventDefault();
    const form = $('#reportForm');
    const payload = collectReport();
    const errors = validateReport(payload);
    if (Object.keys(errors).length) {
      applyFormErrors(form, errors, $('#reportError'), 'Periksa kembali laporan.');
      return;
    }
    const body = {
      title: payload.title,
      type: payload.type,
      occurredAt: payload.occurredAt,
      location: payload.location,
      summary: payload.summary,
      reporterName: payload.reporterName,
      reporterContact: payload.reporterContact,
      lat: payload.lat === '' ? null : Number(payload.lat),
      lng: payload.lng === '' ? null : Number(payload.lng),
    };
    if (!body.occurredAt) delete body.occurredAt;
    const submit = $('#reportSubmit');
    busyButton(submit, true, 'Mengirim…');

    if (!navigator.onLine) {
      queueReport(body);
      clearReportForm();
      busyButton(submit, false);
      toast('Laporan disimpan di perangkat. Akan dikirim otomatis saat online.');
      return;
    }

    try {
      const result = await api('/api/incidents', { method: 'POST', body });
      clearReportForm();
      toast(result.message || 'Laporan diterima dan menunggu pemeriksaan admin.');
      await loadPublic({ silent: true });
    } catch (err) {
      if (err.network || err.data && err.data.offline || err.status === 503) {
        queueReport(body);
        clearReportForm();
        toast('Server belum dapat dijangkau. Laporan disimpan di perangkat dan akan dikirim otomatis.', '');
      } else if (err.errors && Object.keys(err.errors).length) {
        applyFormErrors(form, err.errors, $('#reportError'), err.message);
        toast(err.message, 'error');
      } else {
        const box = $('#reportError');
        if (box) box.textContent = err.message;
        toast(err.message, 'error');
      }
    } finally {
      busyButton(submit, false);
    }
  }

  function setLoginPasswordVisibility(show, focus = true) {
    const input = $('#loginPassword');
    const toggle = $('#loginPasswordToggle');
    if (!input || !toggle) return;
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
    const label = show ? 'Sembunyikan password' : 'Tampilkan password';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    if (focus && show) {
      input.focus();
      const end = input.value.length;
      try {
        input.setSelectionRange(end, end);
      } catch (err) {
        // Input type number tidak mendukung selection; diabaikan.
      }
    }
  }

  function markLoginFieldsInvalid(names = []) {
    const form = $('#loginForm');
    if (!form) return;
    const invalid = new Set(names);
    ['username', 'password'].forEach((name) => {
      const field = form.elements.namedItem(name);
      if (!field) return;
      if (invalid.has(name)) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    });
  }

  function clearLoginFeedback(keepCapsWarning = false) {
    clearFormErrors($('#loginForm'), $('#loginError'));
    markLoginFieldsInvalid([]);
    if (!keepCapsWarning) {
      const caps = $('#loginCapsWarning');
      if (caps) caps.hidden = true;
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    const form = $('#loginForm');
    const usernameField = $('#loginUsername');
    const passwordField = $('#loginPassword');
    const username = usernameField.value.trim();
    const password = passwordField.value;
    const errorBox = $('#loginError');
    clearLoginFeedback();

    const errors = {};
    if (!username) errors.username = 'Username wajib diisi.';
    else if (username.length > 50) errors.username = 'Username maksimal 50 karakter.';
    if (!password) errors.password = 'Password wajib diisi.';
    if (Object.keys(errors).length) {
      applyFormErrors(form, errors, errorBox, 'Periksa kembali data login.');
      markLoginFieldsInvalid(Object.keys(errors));
      const firstInvalid = errors.username ? usernameField : passwordField;
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const submit = $('#loginSubmit');
    busyButton(submit, true, 'Memeriksa…');
    try {
      const result = await api('/api/admin/login', { method: 'POST', body: { username, password } });
      saveSession(result.token, result.admin);
      passwordField.value = '';
      setLoginPasswordVisibility(false, false);
      clearLoginFeedback();
      closeDialog($('#loginDialog'));
      renderHeader();
      toast(result.message || 'Berhasil masuk sebagai admin.');
      if (state.view !== 'dashboard') {
        location.hash = '#dashboard';
      } else {
        route();
      }
      await loadAdminData({ silent: true });
    } catch (err) {
      if (err.status === 401) {
        if (errorBox) errorBox.textContent = 'Username atau password salah. Periksa kembali ejaan username dan pastikan Caps Lock tidak aktif.';
        markLoginFieldsInvalid(['username', 'password']);
        passwordField.focus();
        passwordField.select();
      } else if (err.errors && Object.keys(err.errors).length) {
        applyFormErrors(form, err.errors, errorBox, err.message);
        markLoginFieldsInvalid(Object.keys(err.errors));
      } else if (errorBox) {
        errorBox.textContent = err.message;
      }
    } finally {
      busyButton(submit, false);
    }
  }

  function openLoginDialog() {
    if (state.admin) {
      location.hash = '#dashboard';
      return;
    }
    const form = $('#loginForm');
    if (form) form.reset();
    setLoginPasswordVisibility(false, false);
    clearLoginFeedback();
    openDialog($('#loginDialog'));
    window.setTimeout(() => $('#loginUsername').focus(), 60);
  }

  function doLogout() {
    clearSession();
    renderAll();
    route();
    toast('Anda telah keluar dari mode admin.');
  }

  // ---------------------------------------------------------------------------
  // Navigasi dan inisialisasi
  // ---------------------------------------------------------------------------

  function route() {
    const hash = String(location.hash || '').replace(/^#/, '');
    const view = Object.prototype.hasOwnProperty.call(VIEW_TITLES, hash) ? hash : 'katalog';
    state.view = view;

    $$('.view').forEach((section) => {
      section.classList.toggle('on', section.id === `v-${view}`);
    });
    $$('.main-nav a').forEach((link) => {
      if (link.getAttribute('href') === `#${view}`) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = `${VIEW_TITLES[view]} — REKANA`;

    if (view === 'dashboard' && state.admin && !state.adminData) {
      loadAdminData({ silent: true });
    }
    if (view === 'pembayaran') renderPayment();
    renderDashboard();
    window.scrollTo(0, 0);
  }

  function bindImageFallback(container) {
    if (!container) return;
    container.addEventListener('error', (event) => {
      const img = event.target;
      if (!img || img.tagName !== 'IMG' || !img.dataset.productImage) return;
      if (img.dataset.fallback === '1') return;
      const id = img.dataset.productImage;
      const products = (state.publicData && state.publicData.products) || [];
      const adminProducts = (state.adminData && state.adminData.products) || [];
      const product = products.find((p) => p.id === id) || adminProducts.find((p) => p.id === id);
      if (product) {
        img.dataset.fallback = '1';
        img.src = placeholderSvg(product);
      }
    }, true);
  }

  function bindEvents() {
    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => {
      toast('Koneksi kembali. Menyegarkan data…');
      loadPublic({ silent: true });
      syncQueue({ silent: true });
    });
    window.addEventListener('offline', () => {
      state.offline = true;
      renderHeader();
      toast('Koneksi terputus. Data cache lokal tetap dapat dibaca.', 'error');
    });
    window.addEventListener('storage', (event) => {
      if (event.key === LS.cache) {
        if (applyCache()) {
          state.offline = false;
          renderAll();
        }
      }
      if (event.key === LS.queue) {
        const queue = readLS(LS.queue, []);
        state.queue = Array.isArray(queue) ? queue : [];
        renderReportQueue();
      }
      if (event.key === LS.cart) {
        const cart = readLS(LS.cart, []);
        state.cart = Array.isArray(cart) ? cart.filter((item) => item && item.id) : [];
        renderPayment();
      }
      if (event.key === LS.lastOrder) {
        const lastOrder = readLS(LS.lastOrder, null);
        state.lastOrder = lastOrder && lastOrder.transaction ? lastOrder : null;
        renderOrderResult();
      }
      if (event.key === LS.draft) updateDraftStatus();
    });

    // Login dan navigasi admin
    $('#loginBtn').addEventListener('click', openLoginDialog);
    $('#gateLogin').addEventListener('click', openLoginDialog);
    $('#logoutBtn').addEventListener('click', doLogout);
    $('#loginForm').addEventListener('submit', submitLogin);
    $('#loginPasswordToggle').addEventListener('click', () => {
      setLoginPasswordVisibility($('#loginPassword').type === 'password');
    });
    $('#loginForm').addEventListener('input', () => clearLoginFeedback(true));
    const loginPasswordInput = $('#loginPassword');
    const capsWarning = $('#loginCapsWarning');
    const updateCapsWarning = (event) => {
      if (!capsWarning) return;
      const active = typeof event.getModifierState === 'function' && event.getModifierState('CapsLock');
      capsWarning.hidden = !active;
    };
    loginPasswordInput.addEventListener('keydown', updateCapsWarning);
    loginPasswordInput.addEventListener('keyup', updateCapsWarning);
    loginPasswordInput.addEventListener('blur', () => { if (capsWarning) capsWarning.hidden = true; });
    $('#loginDialog').addEventListener('close', () => {
      $('#loginPassword').value = '';
      setLoginPasswordVisibility(false, false);
      clearLoginFeedback();
    });

    // Katalog
    $('#q').addEventListener('input', (event) => {
      state.catalog.q = event.target.value;
      renderCatalog();
    });
    $('#sort').addEventListener('change', (event) => {
      state.catalog.sort = event.target.value;
      renderCatalog();
    });
    $('#chips').addEventListener('click', (event) => {
      const button = event.target.closest('.chip');
      if (!button) return;
      state.catalog.category = button.dataset.category;
      renderCatalog();
      const next = $$('#chips .chip').find((chip) => chip.dataset.category === state.catalog.category);
      if (next) next.focus();
    });
    $('#grid').addEventListener('click', (event) => {
      if (event.target.closest('[data-retry]')) loadPublic();
      const addButton = event.target.closest('[data-add-to-cart]');
      if (addButton) addToCart(addButton.dataset.addToCart);
    });
    bindImageFallback($('#grid'));

    // Info bencana
    $('#incidentSearch').addEventListener('input', (event) => {
      state.info.q = event.target.value;
      renderIncidentList();
    });
    $('#incidentFilter').addEventListener('change', (event) => {
      state.info.type = event.target.value;
      renderIncidentList();
    });

    // Laporan
    $('#reportForm').addEventListener('input', saveReportDraft);
    $('#reportForm').addEventListener('change', saveReportDraft);
    $('#reportForm').addEventListener('submit', submitReport);
    $('#clearDraftBtn').addEventListener('click', () => {
      clearReportForm();
      toast('Draf laporan dihapus dari perangkat.');
    });
    $('#syncQueueBtn').addEventListener('click', () => syncQueue());

    // Pembayaran publik
    $('#checkoutForm').addEventListener('submit', submitCheckout);
    $('#co-delivery').addEventListener('change', renderDeliveryFields);
    $('#payMethodOptions').addEventListener('change', (event) => {
      const input = event.target.closest('input[name="paymentMethod"]');
      if (input) state.paymentMethod = input.value;
    });
    $('#clearCartBtn').addEventListener('click', async () => {
      if (!state.cart.length) return;
      if (await confirmAction('Kosongkan seluruh isi keranjang?', 'Kosongkan keranjang')) clearCart();
    });
    $('#cartList').addEventListener('click', (event) => {
      const plus = event.target.closest('[data-cart-plus]');
      const minus = event.target.closest('[data-cart-minus]');
      const remove = event.target.closest('[data-cart-remove]');
      if (plus) {
        const item = state.cart.find((entry) => entry.id === plus.dataset.cartPlus);
        if (item) updateCartQuantity(item.id, item.quantity + 1);
      }
      if (minus) {
        const item = state.cart.find((entry) => entry.id === minus.dataset.cartMinus);
        if (item) updateCartQuantity(item.id, item.quantity - 1);
      }
      if (remove) removeCartItem(remove.dataset.cartRemove);
    });
    $('#orderResult').addEventListener('click', (event) => {
      const copy = event.target.closest('[data-copy-code]');
      if (copy) copyText(copy.dataset.copyCode);
    });
    $('#lookupForm').addEventListener('submit', submitLookup);
    bindImageFallback($('#cartList'));

    // Tab dashboard
    $('#tabbtn-ringkasan').parentElement.addEventListener('click', (event) => {
      const button = event.target.closest('[role="tab"]');
      if (button) setAdminTab(button.dataset.tab);
    });
    $('#tabbtn-ringkasan').parentElement.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = $$('[role="tab"]', event.currentTarget);
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      tabs[next].focus();
      setAdminTab(tabs[next].dataset.tab);
    });
    document.addEventListener('click', (event) => {
      const goto = event.target.closest('[data-goto-tab]');
      if (goto) setAdminTab(goto.dataset.gotoTab);
    });

    // Cuaca
    $('#weatherForm').addEventListener('submit', submitWeather);

    // Peringatan
    $('#addWarningBtn').addEventListener('click', () => openWarningDialog());
    $('#warningForm').addEventListener('submit', submitWarning);
    $('#warningAdminList').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      if (button.dataset.action === 'edit-warning') openWarningDialog(id);
      if (button.dataset.action === 'toggle-warning') toggleWarning(id);
      if (button.dataset.action === 'delete-warning') deleteWarning(id);
    });

    // Moderasi kejadian
    $('#modSearch').addEventListener('input', (event) => {
      state.mod.q = event.target.value;
      renderModeration(state.adminData || {});
    });
    $('#modStatus').addEventListener('change', (event) => {
      state.mod.status = event.target.value;
      renderModeration(state.adminData || {});
    });
    $('#moderationList').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      if (button.dataset.action === 'status') setIncidentStatus(id, button.dataset.status, button);
      if (button.dataset.action === 'delete-incident') deleteIncident(id);
    });

    // Produk
    $('#addProductBtn').addEventListener('click', () => openProductDialog());
    $('#productForm').addEventListener('submit', submitProduct);
    $('#productRows').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'edit-product') openProductDialog(button.dataset.id);
      if (button.dataset.action === 'delete-product') deleteProduct(button.dataset.id);
    });
    bindImageFallback($('#productRows'));

    // Kategori
    $('#categoryForm').addEventListener('submit', submitCategory);
    $('#cancelCategoryEdit').addEventListener('click', resetCategoryForm);
    $('#categoryList').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'edit-category') startEditCategory(button.dataset.id);
      if (button.dataset.action === 'delete-category') deleteCategory(button.dataset.id);
    });

    // Transaksi pembayaran
    $('#txSearch').addEventListener('input', (event) => {
      state.tx.q = event.target.value;
      renderTransactionsAdmin(state.adminData || {});
    });
    $('#txStatus').addEventListener('change', (event) => {
      state.tx.status = event.target.value;
      renderTransactionsAdmin(state.adminData || {});
    });
    $('#transactionAdminList').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'verify-tx') openTransactionDialog(button.dataset.id, 'verified');
      if (button.dataset.action === 'cancel-tx') openTransactionDialog(button.dataset.id, 'cancelled');
      if (button.dataset.action === 'delete-tx') deleteTransaction(button.dataset.id);
    });
    $('#transactionForm').addEventListener('submit', submitTransaction);

    // Tombol tutup dialog
    document.addEventListener('click', (event) => {
      const close = event.target.closest('[data-close]');
      if (close) {
        const dialog = close.closest('dialog');
        if (dialog) closeDialog(dialog);
      }
    });
  }

  function init() {
    const session = readLS(LS.session, null);
    if (session && session.token) {
      state.token = String(session.token);
      state.admin = session.admin || null;
    }
    const queue = readLS(LS.queue, []);
    state.queue = Array.isArray(queue) ? queue : [];
    const cart = readLS(LS.cart, []);
    state.cart = Array.isArray(cart) ? cart.filter((item) => item && item.id) : [];
    const lastOrder = readLS(LS.lastOrder, null);
    state.lastOrder = lastOrder && lastOrder.transaction ? lastOrder : null;

    applyCache();
    restoreReportDraft();
    bindEvents();
    renderAll();
    route();

    validateSession().then(() => {
      renderAll();
      if (state.admin) loadAdminData({ silent: true });
    });
    loadPublic({ silent: true });
    syncQueue({ silent: true });

    window.setInterval(() => {
      if (state.queue.length > 0 && navigator.onLine) syncQueue({ silent: true });
    }, 60000);
  }

  init();
})();
