/**
 * MyAnjem V2 — Google Apps Script backend
 * Database is created as a NEW spreadsheet and uses MA2_* tab names.
 * Deploy this project as a Web App; doGet() routes to the four separate HTML pages.
 */

const APP_VERSION = '4.1.0';
const DB_PROPERTY = 'MYANJEM_V2_DB_ID';
const DB_ID_OVERRIDE = '1wno3ToRqTBqSiIl38bCuFs_B48YWsFidGd2acUgzhvs'; // Optional: paste a dedicated spreadsheet ID here.
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'CHANGE_THIS_BEFORE_DEPLOYMENT'; // Replace with a unique password before deployment.
const SESSION_TTL_SECONDS = 21600; // 6 hours
const EMAIL_OTP_TTL_SECONDS = 300;
const EMAIL_OTP_COOLDOWN_SECONDS = 60;
const MAX_ID_DOCUMENT_BYTES = 2 * 1024 * 1024;

const TABLES = {
  CONFIG: 'MA2_CONFIG',
  DRIVERS: 'MA2_DRIVERS',
  ORDERS: 'MA2_ORDERS',
  PAYMENTS: 'MA2_PAYMENTS',
  EVENTS: 'MA2_EVENTS',
  RIDERS: 'MA2_RIDERS',
  RIDER_ORDERS: 'MA2_RIDER_ORDERS',
  AUDIT: 'MA2_AUDIT',
  WITHDRAWALS: 'MA2_WITHDRAWALS'
};

const HEADERS = {
  MA2_CONFIG: ['key', 'value'],
  MA2_DRIVERS: [
    'driverId','name','phone','email','vehicleType','vehicleBrand','plate','region',
    'passwordSalt','passwordHash','status','online','baseFare','farePerKm','rating',
    'ratingCount','balance','lat','lng','lastLocationAt','createdAt','approvedAt','lastLoginAt',
    'emailVerified','identityDocType','identityDocFileId','identityDocFileName','payoutMethod','payoutDetails','payoutUpdatedAt'
  ],
  MA2_ORDERS: [
    'orderId','createdAt','updatedAt','riderName','riderPhone','driverId','driverName',
    'pickupAddress','pickupLat','pickupLng','dropoffAddress','dropoffLat','dropoffLng',
    'distanceKm','durationMin','fare','paymentMethod','paymentStatus','orderStatus','note',
    'cancelReason','acceptedAt','arrivedAt','startedAt','completedAt'
  ],
  MA2_PAYMENTS: ['paymentId','orderId','method','amount','status','reference','updatedAt','creditedAt'],
  MA2_EVENTS: ['eventId','orderId','actorType','actorId','eventType','message','createdAt'],
  MA2_RIDERS: ['riderId','name','phone','email','passwordSalt','passwordHash','status','createdAt','lastLoginAt','emailVerified'],
  MA2_RIDER_ORDERS: ['linkId','orderId','riderId','createdAt'],
  MA2_AUDIT: ['auditId','actor','action','targetType','targetId','detail','createdAt'],
  MA2_WITHDRAWALS: ['withdrawalId','driverId','driverName','amount','method','destination','status','requestedAt','processedAt','adminNote']
};


/**
 * MyAnjem V2 — JSONP API Gateway
 * Frontend: Static HTML hosted externally
 * Backend: Google Apps Script + Google Spreadsheet
 *
 * Compatible with:
 * ?ma2=1&action=bootstrap&payload=...&callback=...
 */

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};

  // Semua request frontend menggunakan JSONP.
  if (String(params.ma2 || '') === '1') {
    return handleJsonp_(params);
  }

  // Endpoint dibuka tanpa parameter API.
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: false,
      message: 'MyAnjem V2 API aktif. Gunakan endpoint JSONP.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** POST bridge untuk data besar/sensitif (dokumen identitas). Frontend memakai
 * hidden iframe + postMessage agar tidak bergantung pada CORS browser. */
function doPost(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const nonce = String(params.nonce || '').replace(/[^A-Za-z0-9_-]/g, '').substring(0, 80);
  let result;
  try {
    if (String(params.ma2 || '') !== '1') throw new Error('Endpoint MyAnjem tidak valid.');
    const payload = params.payload ? JSON.parse(String(params.payload)) : {};
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Format payload tidak valid.');
    result = api(String(params.action || ''), payload);
  } catch (err) {
    result = fail_(err && err.message ? err.message : 'Permintaan POST gagal.');
  }
  // HtmlService content runs inside Google's sandboxed iframe wrapper.
  // parent.postMessage() can target Google's intermediate frame instead of
  // the external page that created the hidden POST iframe. Send to top so the
  // frontend can receive the response; the frontend validates origin + nonce.
  const message = JSON.stringify({ __myanjem: true, nonce: nonce, result: result }).replace(/</g, '\\u003c');
  const responseHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>(function(){var response=' + message + ';' +
    'try{window.top.postMessage(response,"*");}' +
    'catch(err){try{window.parent.parent.postMessage(response,"*");}catch(ignore){}}' +
    '})();<\/script></body></html>';
  return HtmlService.createHtmlOutput(responseHtml)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/**
 * Memproses request JSONP dari empat halaman frontend.
 */
function handleJsonp_(params) {
  const callback = String(params.callback || '');

  // Validasi callback untuk mencegah injeksi JavaScript.
  if (!/^__ma2_cb_[A-Za-z0-9_$]+$/.test(callback)) {
    return ContentService
      .createTextOutput('/* Invalid JSONP callback */')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  let payload = {};

  try {
    // Payload dikirim frontend dalam format Base64 URL-safe.
    const encoded = String(params.payload || '');

    if (encoded) {
      const bytes = Utilities.base64DecodeWebSafe(encoded);
      const decoded = Utilities.newBlob(bytes)
        .getDataAsString('UTF-8');

      payload = JSON.parse(decoded);

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Format payload tidak valid.');
      }
    }

    // Jalankan API utama yang sudah tersedia di Code.gs.
    const result = api(
      String(params.action || ''),
      payload
    );

    return jsonpResponse_(callback, result);

  } catch (error) {
    console.error(error.stack || error);

    return jsonpResponse_(callback, {
      ok: false,
      message: error.message || 'Terjadi kesalahan pada API MyAnjem.'
    });
  }
}


/**
 * Membungkus respons menjadi JavaScript JSONP.
 */
function jsonpResponse_(callback, data) {
  const json = JSON.stringify(data || {
    ok: false,
    message: 'Respons server kosong.'
  });

  return ContentService
    .createTextOutput(callback + '(' + json + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/** Run once from the Apps Script editor. Creates a separate database spreadsheet. */
function setupMyAnjemV2() {
  const props = PropertiesService.getScriptProperties();
  let id = DB_ID_OVERRIDE || props.getProperty(DB_PROPERTY);
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('MyAnjem Database V2');
    id = ss.getId();
    props.setProperty(DB_PROPERTY, id);
  }
  ensureTables_(ss);
  Logger.log('MyAnjem V2 database: ' + ss.getUrl());
  return ss.getUrl();
}

/** Public RPC called by google.script.run from index.html. */
function api(action, payload) {
  payload = payload || {};
  try {
    ensureDatabase_();
    switch (String(action || '')) {
      case 'bootstrap': return ok_({ version: APP_VERSION, settings: publicSettings_() });
      case 'captchaChallenge': return captchaChallenge_();
      case 'sendEmailOtp': return sendEmailOtp_(payload);
      case 'registerRider': return registerRider_(payload);
      case 'riderLogin': return riderLogin_(payload);
      case 'riderMe': return riderMe_(payload);
      case 'riderLogout': return logout_(payload);
      case 'registerDriver': return registerDriver_(payload);
      case 'driverLogin': return driverLogin_(payload);
      case 'adminLogin': return adminLogin_(payload);
      case 'publicDrivers': return publicDrivers_();
      case 'createOrder': return createOrder_(payload);
      case 'getOrder': return getOrder_(payload);
      case 'cancelCustomerOrder': return cancelCustomerOrder_(payload);
      case 'submitPaymentReference': return submitPaymentReference_(payload);
      case 'driverDashboard': return driverDashboard_(payload);
      case 'requestWithdrawal': return requestWithdrawal_(payload);
      case 'adminDriverDocument': return adminDriverDocument_(payload);
      case 'driverUpdate': return driverUpdate_(payload);
      case 'driverLocation': return driverLocation_(payload);
      case 'driverAction': return driverAction_(payload);
      case 'adminDashboard': return adminDashboard_(payload);
      case 'adminAction': return adminAction_(payload);
      case 'logout': return logout_(payload);
      default: return fail_('Aksi tidak dikenali. Muat ulang aplikasi.');
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return fail_(err && err.message ? err.message : 'Terjadi kesalahan server.');
  }
}

/* ------------------------------ DATABASE ------------------------------ */

function ensureDatabase_() {
  const props = PropertiesService.getScriptProperties();
  let id = DB_ID_OVERRIDE || props.getProperty(DB_PROPERTY);
  if (!id) {
    const created = SpreadsheetApp.create('MyAnjem Database V2');
    id = created.getId();
    props.setProperty(DB_PROPERTY, id);
  }
  const cache = CacheService.getScriptCache();
  const readyKey = 'MYANJEM_SCHEMA_READY_' + APP_VERSION + '_' + id;
  if (cache.get(readyKey) !== '1') {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (cache.get(readyKey) !== '1') {
        ensureTables_(SpreadsheetApp.openById(id));
        cache.put(readyKey, '1', 21600);
      }
    } finally { lock.releaseLock(); }
  }
  return SpreadsheetApp.openById(id);
}

/** Jalankan sekali secara manual dari editor Apps Script untuk memberi izin layanan. */
function authorizeMyAnjemServices() {
  const id = DB_ID_OVERRIDE || PropertiesService.getScriptProperties().getProperty(DB_PROPERTY);
  if (id) SpreadsheetApp.openById(id).getId();
  DriveApp.getRootFolder().getId();
  MailApp.getRemainingDailyQuota();
  Logger.log('Izin Spreadsheet, Drive, dan Mail tersedia untuk MyAnjem.');
  return 'Authorization check complete';
}

function ensureTables_(ss) {
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const expected = HEADERS[name];
    const lastCol = sh.getLastColumn();
    let current = lastCol > 0
      ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(v => String(v || '').trim())
      : [];
    while (current.length && !current[current.length - 1]) current.pop();

    if (!current.length) {
      if (sh.getMaxColumns() < expected.length) sh.insertColumnsAfter(sh.getMaxColumns(), expected.length - sh.getMaxColumns());
      sh.getRange(1, 1, 1, expected.length).setValues([expected]);
    } else {
      const compatible = current.length <= expected.length && current.every((header, index) => header === expected[index]);
      if (!compatible) {
        throw new Error('Header tabel ' + name + ' tidak cocok dengan skema MyAnjem V4. Tidak ada kolom yang ditimpa; periksa urutan header sheet terlebih dahulu.');
      }
      if (current.length < expected.length) {
        if (sh.getMaxColumns() < expected.length) sh.insertColumnsAfter(sh.getMaxColumns(), expected.length - sh.getMaxColumns());
        sh.getRange(1, current.length + 1, 1, expected.length - current.length).setValues([expected.slice(current.length)]);
      }
    }
    if (sh.getMaxColumns() < expected.length) sh.insertColumnsAfter(sh.getMaxColumns(), expected.length - sh.getMaxColumns());
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, expected.length).setFontWeight('bold').setBackground('#fce7f3');

    // Store phone fields as text and repair legacy numeric cells that lost their leading zero.
    const phoneColumns = [expected.indexOf('phone') + 1, expected.indexOf('riderPhone') + 1].filter(n => n > 0);
    phoneColumns.forEach(col => {
      const lastRow = sh.getLastRow();
      if (lastRow >= 2) {
        const range = sh.getRange(2, col, lastRow - 1, 1);
        const values = range.getValues().map(row => {
          const value = row[0];
          return [value === '' || value === null ? '' : phone_(value)];
        });
        range.setNumberFormat('@');
        range.setValues(values);
      } else {
        sh.getRange(2, col, 1, 1).setNumberFormat('@');
      }
    });
  });
  const cfg = readConfig_();
  const defaults = {
    brand: 'MyAnjem', defaultBaseFare: '7000', defaultFarePerKm: '2500', minimumFare: '10000',
    cancelFee: '0', bankName: 'Bank / E-Wallet', bankAccount: 'Atur nomor rekening di panel admin',
    bankHolder: 'MyAnjem', helpPhone: '', qrisImageUrl: '', qrisMerchantName: 'MyAnjem'
  };
  Object.keys(defaults).forEach(k => { if (!(k in cfg)) upsertConfig_(k, defaults[k]); });
}

function db_() {
  const id = DB_ID_OVERRIDE || PropertiesService.getScriptProperties().getProperty(DB_PROPERTY);
  if (!id) throw new Error('Database belum dibuat. Jalankan setupMyAnjemV2() terlebih dahulu.');
  return SpreadsheetApp.openById(id);
}

function sheet_(table) {
  const sh = db_().getSheetByName(table);
  if (!sh) throw new Error('Tabel ' + table + ' tidak ditemukan. Jalankan setupMyAnjemV2().');
  return sh;
}

function records_(table) {
  const sh = sheet_(table);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map((row, idx) => {
    const obj = { _row: idx + 2 };
    headers.forEach((h, i) => obj[h] = serial_(row[i]));
    return obj;
  }).filter(r => Object.keys(r).some(k => k !== '_row' && r[k] !== '' && r[k] !== null));
}

function append_(table, obj) {
  const sh = sheet_(table);
  const headers = HEADERS[table];
  sh.appendRow(headers.map(h => obj[h] === undefined ? '' : obj[h]));
}

function update_(table, rowNumber, patch) {
  const sh = sheet_(table);
  const headers = HEADERS[table];
  const current = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  headers.forEach((h, i) => {
    if (Object.prototype.hasOwnProperty.call(patch, h)) current[i] = patch[h];
  });
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([current]);
}

function find_(table, field, value) {
  const target = String(value == null ? '' : value).trim();
  return records_(table).find(r => String(r[field] == null ? '' : r[field]).trim() === target) || null;
}

function readConfig_() {
  const out = {};
  records_(TABLES.CONFIG).forEach(r => out[String(r.key)] = String(r.value == null ? '' : r.value));
  return out;
}

function upsertConfig_(key, value) {
  const found = find_(TABLES.CONFIG, 'key', key);
  if (found) update_(TABLES.CONFIG, found._row, { value: String(value) });
  else append_(TABLES.CONFIG, { key: String(key), value: String(value) });
}

function publicSettings_() {
  const c = readConfig_();
  return {
    brand: c.brand || 'MyAnjem',
    defaultBaseFare: number_(c.defaultBaseFare, 7000),
    defaultFarePerKm: number_(c.defaultFarePerKm, 2500),
    minimumFare: number_(c.minimumFare, 10000),
    cancelFee: number_(c.cancelFee, 0),
    bankName: c.bankName || '',
    bankAccount: c.bankAccount || '',
    bankHolder: c.bankHolder || '',
    helpPhone: c.helpPhone || '',
    qrisImageUrl: c.qrisImageUrl || '',
    qrisMerchantName: c.qrisMerchantName || 'MyAnjem'
  };
}

function serial_(v) {
  return v instanceof Date ? v.toISOString() : v;
}

/* ------------------------------ SECURITY ------------------------------ */

function randomId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase();
}


function hashPassword_(password, salt) {
  const normalizedSalt = String(salt == null ? '' : salt).trim();

  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    normalizedSalt + String(password == null ? '' : password),
    Utilities.Charset.UTF_8
  );

  return Utilities.base64Encode(bytes);
}


function createSession_(role, userId, extra) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('MYANJEM_V2_SESSION_' + token, JSON.stringify({ role: role, userId: userId, extra: extra || {} }), SESSION_TTL_SECONDS);
  return token;
}

function session_(token, role) {
  if (!token) throw new Error('Sesi tidak ditemukan. Silakan masuk kembali.');
  const raw = CacheService.getScriptCache().get('MYANJEM_V2_SESSION_' + String(token));
  if (!raw) throw new Error('Sesi sudah berakhir. Silakan masuk kembali.');
  const s = JSON.parse(raw);
  if (role && s.role !== role) throw new Error('Akses tidak diizinkan.');
  return s;
}

function logout_(p) {
  if (p.token) CacheService.getScriptCache().remove('MYANJEM_V2_SESSION_' + String(p.token));
  return ok_({ loggedOut: true });
}

/* ------------------------------ EMAIL VERIFICATION ------------------------------ */
function sendEmailOtp_(p) {
  const role = String(p.role || '');
  if (!['rider', 'driver'].includes(role)) return fail_('Jenis verifikasi tidak valid.');
  const email = String(p.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return fail_('Masukkan alamat email yang valid.');
  const cache = CacheService.getScriptCache();
  const key = 'MYANJEM_V4_OTP_' + role + '_' + email;
  const cooldown = cache.get(key + '_cooldown');
  if (cooldown) return fail_('Kode sudah dikirim. Coba kirim ulang setelah 60 detik.');
  const otpSeed = Utilities.getUuid().replace(/-/g, '').substring(0, 8);
  const otp = String(parseInt(otpSeed, 16) % 1000000).padStart(6, '0');
  const salt = Utilities.getUuid();
  const hash = hashPassword_(otp, salt);
  cache.put(key, JSON.stringify({ salt: salt, hash: hash, attempts: 0 }), EMAIL_OTP_TTL_SECONDS);
  cache.put(key + '_cooldown', '1', EMAIL_OTP_COOLDOWN_SECONDS);
  const roleLabel = role === 'driver' ? 'pendaftaran driver' : 'pendaftaran penumpang';
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#25212a;max-width:520px;margin:auto">' +
    '<h2 style="color:#c92d75">Verifikasi Email MyAnjem</h2><p>Gunakan kode berikut untuk melanjutkan ' + roleLabel + '.</p>' +
    '<p style="font-size:30px;font-weight:bold;letter-spacing:8px;background:#fff0f6;padding:16px;text-align:center;border-radius:10px">' + otp + '</p>' +
    '<p>Kode berlaku selama 5 menit. Jangan bagikan kode ini kepada siapa pun.</p><p style="color:#777">Abaikan email ini jika kamu tidak meminta kode verifikasi.</p></div>';
  try {
    MailApp.sendEmail({ to: email, subject: 'Kode verifikasi MyAnjem', htmlBody: htmlBody, body: 'Kode verifikasi MyAnjem: ' + otp + '. Berlaku 5 menit.' });
    return ok_({ sent: true, expiresIn: EMAIL_OTP_TTL_SECONDS });
  } catch (err) {
    cache.remove(key); cache.remove(key + '_cooldown');
    return fail_('Email belum dapat dikirim. Pastikan izin MailApp sudah diberikan dan kuota email tersedia.');
  }
}

function consumeEmailOtp_(role, email, otp) {
  const key = 'MYANJEM_V4_OTP_' + role + '_' + String(email || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key);
  if (!raw) return false;
  const state = JSON.parse(raw);
  if (Number(state.attempts || 0) >= 5) { cache.remove(key); return false; }
  const valid = hashPassword_(String(otp || ''), state.salt) === String(state.hash || '');
  if (!valid) {
    state.attempts = Number(state.attempts || 0) + 1;
    cache.put(key, JSON.stringify(state), EMAIL_OTP_TTL_SECONDS);
    return false;
  }
  cache.remove(key);
  cache.remove(key + '_cooldown');
  return true;
}

/* ------------------------------ PASSENGER ACCOUNTS ------------------------------ */

function safeRider_(r) {
  if (!r) return null;
  return {
    riderId: String(r.riderId || ''),
    name: String(r.name || ''),
    phone: String(r.phone || ''),
    email: String(r.email || ''),
    status: String(r.status || 'ACTIVE'),
    createdAt: serial_(r.createdAt)
  };
}

function registerRider_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const name = clean_(p.name, 90);
    const phone = phone_(p.phone);
    const email = clean_(String(p.email || '').toLowerCase(), 120);
    const password = String(p.password || '');
    if (name.length < 2) return fail_('Nama lengkap minimal 2 karakter.');
    if (!/^0[0-9]{8,14}$/.test(phone)) return fail_('Nomor telepon harus memakai format 08xxxxxxxxxx.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail_('Email wajib diisi dengan alamat yang valid.');
    if (password.length < 8) return fail_('Kata sandi minimal 8 karakter.');
    if (records_(TABLES.RIDERS).some(r => String(r.phone) === phone || String(r.email || '').toLowerCase() === email)) return fail_('Nomor telepon atau email sudah terdaftar. Silakan masuk.');
    if (!consumeEmailOtp_('rider', email, p.emailOtp)) return fail_('Kode verifikasi email salah atau kedaluwarsa. Kirim kode baru.');
    const salt = Utilities.getUuid();
    const rider = {
      riderId: randomId_('RDR'), name: name, phone: phone, email: email,
      passwordSalt: salt, passwordHash: hashPassword_(password, salt),
      status: 'ACTIVE', createdAt: now_(), lastLoginAt: now_(), emailVerified: true
    };
    append_(TABLES.RIDERS, rider);
    const token = createSession_('rider', rider.riderId);
    return ok_({ token: token, rider: safeRider_(rider) });
  } finally {
    lock.releaseLock();
  }
}

function riderLogin_(p) {
  const phone = phone_(p.phone);
  const password = String(p.password || '');
  if (phone.length < 9 || !password) return fail_('Masukkan nomor telepon dan kata sandi.');
  const rider = find_(TABLES.RIDERS, 'phone', phone);
  if (!rider || hashPassword_(password, rider.passwordSalt) !== String(rider.passwordHash)) return fail_('Nomor telepon atau kata sandi salah.');
  if (String(rider.status) !== 'ACTIVE') return fail_('Akun penumpang sedang dinonaktifkan. Hubungi bantuan MyAnjem.');
  update_(TABLES.RIDERS, rider._row, { lastLoginAt: now_() });
  const token = createSession_('rider', rider.riderId);
  return ok_({ token: token, rider: safeRider_(rider) });
}

function riderMe_(p) {
  const s = session_(p.token, 'rider');
  const rider = find_(TABLES.RIDERS, 'riderId', s.userId);
  if (!rider || String(rider.status) !== 'ACTIVE') throw new Error('Akun penumpang tidak aktif.');
  const links = records_(TABLES.RIDER_ORDERS).filter(x => String(x.riderId) === String(rider.riderId));
  const orders = links.map(x => find_(TABLES.ORDERS, 'orderId', x.orderId)).filter(Boolean)
    .sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30).map(safeOrder_);
  return ok_({ rider: safeRider_(rider), orders: orders });
}

/* ------------------------------ DRIVER ------------------------------ */

function captchaChallenge_() {
  const a = 12 + Math.floor(Math.random() * 18);
  const b = 3 + Math.floor(Math.random() * 9);
  const token = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('MYANJEM_V2_CAPTCHA_' + token, String(a + b), 300);
  return ok_({ captchaToken: token, question: 'Berapakah ' + a + ' + ' + b + ' ?' });
}

function registerDriver_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const token = String(p.captchaToken || '');
    const cache = CacheService.getScriptCache();
    const expected = token ? cache.get('MYANJEM_V2_CAPTCHA_' + token) : null;
    if (token) cache.remove('MYANJEM_V2_CAPTCHA_' + token);
    if (!expected || String(Number(p.captchaAnswer)) !== expected) return fail_('Verifikasi keamanan salah atau kedaluwarsa. Muat tantangan baru.');
    const name = clean_(p.name, 90), phone = phone_(p.phone), email = clean_(String(p.email || '').toLowerCase(), 120);
    const password = String(p.password || ''), plate = clean_(p.plate, 20).toUpperCase();
    if (name.length < 3) return fail_('Nama lengkap minimal 3 karakter.');
    if (!/^0[0-9]{8,14}$/.test(phone)) return fail_('Nomor telepon harus memakai format 08xxxxxxxxxx.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail_('Email wajib diisi dengan alamat yang valid.');
    if (password.length < 8) return fail_('Kata sandi minimal 8 karakter.');
    if (plate.length < 3) return fail_('Nomor polisi kendaraan wajib diisi.');
    if (records_(TABLES.DRIVERS).some(d => String(d.phone) === phone || String(d.email || '').toLowerCase() === email)) return fail_('Nomor telepon atau email sudah terdaftar.');
    if (!consumeEmailOtp_('driver', email, p.emailOtp)) return fail_('Kode verifikasi email salah atau kedaluwarsa. Kirim kode baru.');
    const doc = p.identityDocument || {};
    if (!doc.base64 || !doc.mimeType || !doc.fileName) return fail_('Unggah KTP atau KTM untuk verifikasi identitas.');
    const storedDoc = saveDriverDocument_(doc);
    const salt = Utilities.getUuid(), settings = publicSettings_();
    const d = {
      driverId: randomId_('DRV'), name: name, phone: phone, email: email,
      vehicleType: p.vehicleType === 'Mobil' ? 'Mobil' : 'Motor',
      vehicleBrand: clean_(p.vehicleBrand, 60), plate: plate, region: clean_(p.region, 100),
      passwordSalt: salt, passwordHash: hashPassword_(password, salt), status: 'PENDING', online: false,
      baseFare: Math.max(0, number_(p.baseFare, settings.defaultBaseFare)),
      farePerKm: Math.max(0, number_(p.farePerKm, settings.defaultFarePerKm)),
      rating: 5, ratingCount: 0, balance: 0, lat: '', lng: '', lastLocationAt: '',
      createdAt: now_(), approvedAt: '', lastLoginAt: '', emailVerified: true,
      identityDocType: doc.documentType === 'KTM' ? 'KTM' : 'KTP',
      identityDocFileId: storedDoc.fileId, identityDocFileName: storedDoc.fileName,
      payoutMethod: '', payoutDetails: '', payoutUpdatedAt: ''
    };
    append_(TABLES.DRIVERS, d);
    return ok_({ driverId: d.driverId, status: d.status, message: 'Pendaftaran berhasil. Akun menunggu pemeriksaan dokumen dan persetujuan admin.' });
  } finally {
    lock.releaseLock();
  }
}
function saveDriverDocument_(doc) {
  const mimeType = String(doc.mimeType || '').toLowerCase();
  if (!['image/jpeg','image/png','application/pdf'].includes(mimeType)) throw new Error('Dokumen harus berformat JPG, PNG, atau PDF.');
  const encoded = String(doc.base64 || '').replace(/^data:[^,]+,/, '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (encoded.length > Math.ceil(MAX_ID_DOCUMENT_BYTES / 3) * 4 + 16) throw new Error('Ukuran dokumen maksimal 2 MB.');
  const bytes = Utilities.base64Decode(encoded);
  if (!bytes.length || bytes.length > MAX_ID_DOCUMENT_BYTES) throw new Error('Ukuran dokumen maksimal 2 MB.');
  // Do not trust the browser-supplied MIME type alone; verify the file signature.
  const signature = bytes.slice(0, 8).map(function(b) { return (b + 256) % 256; });
  const isJpeg = signature[0] === 0xFF && signature[1] === 0xD8 && signature[2] === 0xFF;
  const isPng = signature.join(',') === '137,80,78,71,13,10,26,10';
  const isPdf = signature[0] === 0x25 && signature[1] === 0x50 && signature[2] === 0x44 && signature[3] === 0x46;
  if ((mimeType === 'image/jpeg' && !isJpeg) || (mimeType === 'image/png' && !isPng) || (mimeType === 'application/pdf' && !isPdf)) {
    throw new Error('Isi file tidak sesuai dengan format dokumen yang dipilih. Pilih ulang JPG, PNG, atau PDF yang valid.');
  }
  const cleanName = clean_(doc.fileName || 'identitas', 80).replace(/[\\/:*?"<>|]/g, '_');
  const blob = Utilities.newBlob(bytes, mimeType, 'MyAnjem-' + Date.now() + '-' + cleanName);
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('MYANJEM_DRIVER_DOC_FOLDER_ID');
  let folder;
  if (folderId) { try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; } }
  if (!folder) { folder = DriveApp.createFolder('MyAnjem - Dokumen Identitas Driver'); props.setProperty('MYANJEM_DRIVER_DOC_FOLDER_ID', folder.getId()); }
  const file = folder.createFile(blob);
  return { fileId: file.getId(), fileName: cleanName };
}


function driverLogin_(p) {
  const inputPhone = phone_(p.phone);
  const inputPassword = String(p.password == null ? '' : p.password);

  if (!inputPhone || !inputPassword) {
    return fail_('Nomor telepon dan kata sandi wajib diisi.');
  }

  const drivers = records_(TABLES.DRIVERS);

  // Normalisasi nomor telepon dari input dan Spreadsheet.
  const d = drivers.find(function(driver) {
    return phone_(driver.phone) === inputPhone;
  });

  if (!d) {
    return fail_('Nomor telepon atau kata sandi salah.');
  }

  const salt = String(d.passwordSalt == null ? '' : d.passwordSalt).trim();
  const storedHash = String(d.passwordHash == null ? '' : d.passwordHash).trim();

  if (!salt || !storedHash) {
    console.error('Driver memiliki data autentikasi yang tidak lengkap: ' + d.driverId);
    return fail_('Data keamanan akun bermasalah. Hubungi admin MyAnjem.');
  }

  const calculatedHash = hashPassword_(inputPassword, salt);

  // Verifikasi password tanpa melewati autentikasi.
  if (calculatedHash !== storedHash) {
    return fail_('Nomor telepon atau kata sandi salah.');
  }

  if (d.status === 'REJECTED' || d.status === 'SUSPENDED') {
    return fail_('Akun driver belum dapat digunakan. Hubungi admin MyAnjem.');
  }

  if (d.status !== 'APPROVED') {
    return fail_('Akun driver masih menunggu persetujuan admin.');
  }

  const token = createSession_('driver', d.driverId);

  update_(TABLES.DRIVERS, d._row, {
    lastLoginAt: now_()
  });

  return ok_({
    token: token,
    driver: safeDriver_(d)
  });
}


function publicDrivers_() {
  const drivers = records_(TABLES.DRIVERS)
    .filter(d => d.status === 'APPROVED' && String(d.online) === 'true')
    .map(publicDriver_);
  return ok_({ drivers: drivers });
}

function driverDashboard_(p) {
  const s = session_(p.token, 'driver');
  const d = find_(TABLES.DRIVERS, 'driverId', s.userId);
  if (!d) return fail_('Akun driver tidak ditemukan.');
  const orders = records_(TABLES.ORDERS).filter(o => String(o.driverId) === String(d.driverId))
    .sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100);
  const completed = orders.filter(o => o.orderStatus === 'COMPLETED');
  return ok_({
    driver: safeDriver_(d), orders: orders.map(safeOrder_),
    withdrawals: records_(TABLES.WITHDRAWALS).filter(w => String(w.driverId) === String(d.driverId)).sort((a,b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).slice(0, 30),
    stats: { total: completed.length, active: orders.filter(o => ['REQUESTED','ACCEPTED','ARRIVED','ON_TRIP'].includes(o.orderStatus)).length,
      earnings: completed.reduce((sum,o) => sum + number_(o.fare,0), 0) }
  });
}

function driverUpdate_(p) {
  const s = session_(p.token, 'driver');
  const d = find_(TABLES.DRIVERS, 'driverId', s.userId);
  if (!d) return fail_('Akun driver tidak ditemukan.');
  const patch = {};
  if (p.online !== undefined) {
    if (d.status !== 'APPROVED' && p.online) return fail_('Akun harus disetujui admin sebelum bisa online.');
    patch.online = Boolean(p.online);
  }
  if (p.baseFare !== undefined) patch.baseFare = Math.max(0, Math.min(1000000, number_(p.baseFare, d.baseFare)));
  if (p.farePerKm !== undefined) patch.farePerKm = Math.max(0, Math.min(100000, number_(p.farePerKm, d.farePerKm)));
  if (p.vehicleBrand !== undefined) patch.vehicleBrand = clean_(p.vehicleBrand, 60);
  if (p.plate !== undefined) patch.plate = clean_(p.plate, 20).toUpperCase();
  if (p.payoutMethod !== undefined) { const m = String(p.payoutMethod || ''); if (!['BANK','QRIS'].includes(m)) return fail_('Metode pencairan tidak valid.'); patch.payoutMethod = m; }
  if (p.payoutDetails !== undefined) { const v = clean_(p.payoutDetails, 220); if (v.length < 5) return fail_('Detail rekening atau QRIS belum lengkap.'); patch.payoutDetails = v; }
  if (p.payoutMethod !== undefined || p.payoutDetails !== undefined) patch.payoutUpdatedAt = now_();
  if (!Object.keys(patch).length) return fail_('Tidak ada perubahan yang disimpan.');
  update_(TABLES.DRIVERS, d._row, patch);
  return ok_({ driver: safeDriver_(find_(TABLES.DRIVERS, 'driverId', d.driverId)) });
}

function driverLocation_(p) {
  const s = session_(p.token, 'driver');
  const d = find_(TABLES.DRIVERS, 'driverId', s.userId);
  if (!d) return fail_('Akun driver tidak ditemukan.');
  if (String(d.online) !== 'true') return fail_('Aktifkan status online sebelum membagikan lokasi.');
  const lat = number_(p.lat, NaN), lng = number_(p.lng, NaN);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail_('Koordinat GPS tidak valid.');
  update_(TABLES.DRIVERS, d._row, { lat: lat, lng: lng, lastLocationAt: now_() });
  return ok_({ saved: true, at: now_() });
}

function driverAction_(p) {
  const s = session_(p.token, 'driver');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const o = find_(TABLES.ORDERS, 'orderId', p.orderId);
    const d = find_(TABLES.DRIVERS, 'driverId', s.userId);
    if (!o || !d) return fail_('Pesanan atau akun driver tidak ditemukan.');
    if (String(o.driverId) !== String(d.driverId)) return fail_('Pesanan ini bukan untuk akun Anda.');
    const action = String(p.action || '');
    const patch = { updatedAt: now_() };
    const eventMessages = {
      accept: ['ACCEPTED','Driver menerima pesanan'],
      decline: ['DECLINED','Driver menolak pesanan'],
      arrive: ['ARRIVED','Driver tiba di titik jemput'],
      start: ['ON_TRIP','Perjalanan dimulai'],
      complete: ['COMPLETED','Perjalanan selesai'],
      cancel: ['CANCELLED','Driver membatalkan pesanan']
    };
    if (!eventMessages[action]) return fail_('Aksi perjalanan tidak valid.');
    if (action === 'accept') {
      if (o.orderStatus !== 'REQUESTED') return fail_('Pesanan sudah diproses atau tidak lagi tersedia.');
      patch.orderStatus = 'ACCEPTED'; patch.acceptedAt = now_(); patch.driverName = d.name;
    } else if (action === 'decline') {
      if (o.orderStatus !== 'REQUESTED') return fail_('Pesanan tidak dapat ditolak pada tahap ini.');
      patch.orderStatus = 'DECLINED'; patch.driverId = ''; patch.driverName = '';
    } else if (action === 'arrive') {
      if (o.orderStatus !== 'ACCEPTED') return fail_('Tandai tiba setelah pesanan diterima.');
      patch.orderStatus = 'ARRIVED'; patch.arrivedAt = now_();
    } else if (action === 'start') {
      if (o.orderStatus !== 'ARRIVED') return fail_('Perjalanan dapat dimulai setelah driver tiba.');
      patch.orderStatus = 'ON_TRIP'; patch.startedAt = now_();
    } else if (action === 'complete') {
      if (o.orderStatus !== 'ON_TRIP') return fail_('Pesanan belum dalam perjalanan.');
      patch.orderStatus = 'COMPLETED'; patch.completedAt = now_();
      if (o.paymentMethod === 'CASH') patch.paymentStatus = 'PAID_CASH';
    } else if (action === 'cancel') {
      if (!['REQUESTED','ACCEPTED','ARRIVED'].includes(o.orderStatus)) return fail_('Pesanan tidak dapat dibatalkan pada tahap ini.');
      patch.orderStatus = 'CANCELLED'; patch.cancelReason = clean_(p.reason || 'Dibatalkan driver', 180);
      patch.driverId = ''; patch.driverName = '';
    }
    update_(TABLES.ORDERS, o._row, patch);
    addEvent_(o.orderId, 'DRIVER', d.driverId, eventMessages[action][0], eventMessages[action][1]);
    if (action === 'complete') {
      const pay = find_(TABLES.PAYMENTS, 'orderId', o.orderId);
      if (pay && o.paymentMethod === 'CASH') {
        update_(TABLES.PAYMENTS, pay._row, { status: 'PAID_CASH', updatedAt: now_() });
      } else if (pay && ['TRANSFER','QRIS'].includes(String(o.paymentMethod)) && pay.status !== 'PAID') {
        update_(TABLES.PAYMENTS, pay._row, { status: 'WAITING_CONFIRMATION', updatedAt: now_() });
        const completedOrder = find_(TABLES.ORDERS, 'orderId', o.orderId);
        if (completedOrder) update_(TABLES.ORDERS, completedOrder._row, { paymentStatus: 'WAITING_CONFIRMATION', updatedAt: now_() });
      } else if (pay && pay.status === 'PAID' && o.paymentMethod !== 'CASH') {
        if (creditDriverWallet_(o, pay)) update_(TABLES.PAYMENTS, pay._row, { creditedAt: now_(), updatedAt: now_() });
      }
    }
    return ok_({ order: safeOrder_(find_(TABLES.ORDERS, 'orderId', o.orderId)) });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------ DRIVER WALLET / DOCUMENTS ------------------------------ */
function creditDriverWallet_(order, payment) {
  if (!order || !payment || order.paymentMethod === 'CASH' || payment.status !== 'PAID' || payment.creditedAt || !order.driverId) return false;
  const driver = find_(TABLES.DRIVERS, 'driverId', order.driverId);
  if (!driver) return false;
  update_(TABLES.DRIVERS, driver._row, { balance: number_(driver.balance, 0) + number_(payment.amount, 0) });
  return true;
}

function requestWithdrawal_(p) {
  const s = session_(p.token, 'driver');
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const d = find_(TABLES.DRIVERS, 'driverId', s.userId);
    if (!d || d.status !== 'APPROVED') return fail_('Akun driver belum aktif.');
    const amount = Math.floor(number_(p.amount, 0));
    const balance = number_(d.balance, 0);
    if (amount < 10000) return fail_('Minimal penarikan Rp10.000.');
    if (amount > balance) return fail_('Saldo tidak mencukupi.');
    const method = String(d.payoutMethod || '');
    const destination = String(d.payoutDetails || '').trim();
    if (!['BANK','QRIS'].includes(method) || destination.length < 5) return fail_('Lengkapi rekening bank atau detail QRIS di profil pencairan terlebih dahulu.');
    const id = randomId_('WD');
    append_(TABLES.WITHDRAWALS, { withdrawalId: id, driverId: d.driverId, driverName: d.name, amount: amount, method: method, destination: destination, status: 'PENDING', requestedAt: now_(), processedAt: '', adminNote: '' });
    update_(TABLES.DRIVERS, d._row, { balance: balance - amount });
    return ok_({ withdrawalId: id, balance: balance - amount });
  } finally { lock.releaseLock(); }
}

function adminDriverDocument_(p) {
  session_(p.token, 'admin');
  const d = find_(TABLES.DRIVERS, 'driverId', p.driverId);
  if (!d || !d.identityDocFileId) return fail_('Dokumen identitas tidak ditemukan.');
  const file = DriveApp.getFileById(String(d.identityDocFileId));
  const blob = file.getBlob();
  return ok_({ fileName: file.getName(), mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) });
}

/* ------------------------------ CUSTOMER ORDERS ------------------------------ */

function createOrder_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const riderName = clean_(p.riderName, 90);
    const riderPhone = phone_(p.riderPhone);
    const pickupAddress = clean_(p.pickupAddress, 240);
    const dropoffAddress = clean_(p.dropoffAddress, 240);
    const pickupLat = number_(p.pickupLat, NaN), pickupLng = number_(p.pickupLng, NaN);
    const dropoffLat = number_(p.dropoffLat, NaN), dropoffLng = number_(p.dropoffLng, NaN);
    const distanceKm = Math.max(0.1, Math.min(300, number_(p.distanceKm, 1)));
    const durationMin = Math.max(1, Math.min(600, number_(p.durationMin, distanceKm * 3)));
    if (riderName.length < 2) return fail_('Nama penumpang wajib diisi.');
    if (riderPhone.length < 9) return fail_('Nomor telepon penumpang belum valid.');
    let accountRider = null;
    if (p.riderToken) {
      const riderSession = session_(p.riderToken, 'rider');
      accountRider = find_(TABLES.RIDERS, 'riderId', riderSession.userId);
      if (!accountRider || String(accountRider.status) !== 'ACTIVE' || String(accountRider.phone) !== riderPhone) {
        return fail_('Sesi akun penumpang tidak cocok. Silakan masuk kembali.');
      }
      if (String(accountRider.name) !== riderName) return fail_('Nama pesanan harus sesuai dengan nama akun.');
    }
    if (!pickupAddress || !dropoffAddress) return fail_('Alamat jemput dan tujuan wajib diisi.');
    if (![pickupLat,pickupLng,dropoffLat,dropoffLng].every(isFinite)) return fail_('Pilih alamat dari hasil pencarian agar titik peta tersimpan.');
    const method = ['TRANSFER','QRIS'].includes(String(p.paymentMethod || '')) ? String(p.paymentMethod) : 'CASH';
    const cfg = publicSettings_();
    if (method === 'QRIS' && !cfg.qrisImageUrl) return fail_('QRIS belum diatur oleh admin. Pilih tunai atau transfer.');
    const driver = p.driverId ? find_(TABLES.DRIVERS, 'driverId', p.driverId) : null;
    if (p.driverId && (!driver || driver.status !== 'APPROVED' || String(driver.online) !== 'true')) return fail_('Driver yang dipilih sudah tidak tersedia. Perbarui daftar driver.');
    const base = driver ? number_(driver.baseFare, cfg.defaultBaseFare) : cfg.defaultBaseFare;
    const perKm = driver ? number_(driver.farePerKm, cfg.defaultFarePerKm) : cfg.defaultFarePerKm;
    const fare = roundTo500_(Math.max(cfg.minimumFare, base + (perKm * distanceKm)));
    const orderId = randomId_('MA');
    const o = {
      orderId: orderId, createdAt: now_(), updatedAt: now_(),
      riderName: riderName, riderPhone: riderPhone,
      driverId: driver ? driver.driverId : '', driverName: driver ? driver.name : '',
      pickupAddress: pickupAddress, pickupLat: pickupLat, pickupLng: pickupLng,
      dropoffAddress: dropoffAddress, dropoffLat: dropoffLat, dropoffLng: dropoffLng,
      distanceKm: distanceKm, durationMin: durationMin, fare: fare,
      paymentMethod: method, paymentStatus: method === 'CASH' ? 'PAY_ON_COMPLETION' : 'UNPAID',
      orderStatus: 'REQUESTED', note: clean_(p.note, 240), cancelReason: '',
      acceptedAt: '', arrivedAt: '', startedAt: '', completedAt: ''
    };
    append_(TABLES.ORDERS, o);
    if (accountRider) append_(TABLES.RIDER_ORDERS, { linkId: randomId_('RLK'), orderId: orderId, riderId: accountRider.riderId, createdAt: now_() });
    addEvent_(orderId, 'CUSTOMER', accountRider ? accountRider.riderId : riderPhone, 'REQUESTED', 'Pesanan dibuat oleh penumpang');
    append_(TABLES.PAYMENTS, {
      paymentId: randomId_('PAY'), orderId: orderId, method: method, amount: fare,
      status: method === 'CASH' ? 'PAY_ON_COMPLETION' : 'UNPAID', reference: '', updatedAt: now_(), creditedAt: ''
    });
    return ok_({ order: safeOrder_(o), settings: cfg });
  } finally {
    lock.releaseLock();
  }
}

function cancelCustomerOrder_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const id = clean_(p.orderId, 40), phone = phone_(p.phone);
    const o = find_(TABLES.ORDERS, 'orderId', id);
    if (!o || String(o.riderPhone) !== phone) return fail_('Pesanan tidak ditemukan.');
    if (o.orderStatus !== 'REQUESTED') return fail_('Pesanan hanya dapat dibatalkan penumpang sebelum diterima driver. Hubungi admin jika ada kendala.');
    update_(TABLES.ORDERS, o._row, { orderStatus: 'CANCELLED', cancelReason: 'Dibatalkan penumpang', updatedAt: now_() });
    addEvent_(id, 'CUSTOMER', phone, 'CANCELLED', 'Pesanan dibatalkan penumpang');
    return ok_({ cancelled: true });
  } finally {
    lock.releaseLock();
  }
}

function submitPaymentReference_(p) {
  const id = clean_(p.orderId, 40), phone = phone_(p.phone), reference = clean_(p.reference, 120);
  if (reference.length < 3) return fail_('Masukkan nomor referensi atau catatan transfer.');
  const o = find_(TABLES.ORDERS, 'orderId', id);
  if (!o || String(o.riderPhone) !== phone) return fail_('Pesanan tidak ditemukan.');
  if (!['TRANSFER','QRIS'].includes(String(o.paymentMethod))) return fail_('Pesanan ini menggunakan pembayaran tunai.');
  const pay = find_(TABLES.PAYMENTS, 'orderId', id);
  if (!pay) return fail_('Data pembayaran tidak ditemukan.');
  if (pay.status === 'PAID' || pay.creditedAt) return fail_('Pembayaran pesanan ini sudah dikonfirmasi.');
  if (['CANCELLED','DECLINED'].includes(String(o.orderStatus))) return fail_('Pesanan sudah dibatalkan atau ditolak; hubungi admin untuk bantuan.');
  update_(TABLES.PAYMENTS, pay._row, { reference: reference, status: 'WAITING_CONFIRMATION', updatedAt: now_() });
  update_(TABLES.ORDERS, o._row, { paymentStatus: 'WAITING_CONFIRMATION', updatedAt: now_() });
  addEvent_(id, 'CUSTOMER', phone, 'PAYMENT_REFERENCE', 'Referensi transfer dikirim untuk verifikasi admin');
  return ok_({ submitted: true });
}

function getOrder_(p) {
  const id = clean_(p.orderId, 40);
  const phone = phone_(p.phone);
  const o = find_(TABLES.ORDERS, 'orderId', id);
  if (!o || String(o.riderPhone) !== phone) return fail_('Pesanan tidak ditemukan. Periksa kode pesanan dan nomor telepon.');
  let d = o.driverId ? find_(TABLES.DRIVERS, 'driverId', o.driverId) : null;
  const events = records_(TABLES.EVENTS).filter(e => String(e.orderId) === id)
    .sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(-30)
    .map(e => ({ eventType: e.eventType, message: e.message, createdAt: e.createdAt }));
  let publicTrackingDriver = d ? publicDriver_(d) : null;
  if (publicTrackingDriver) {
    publicTrackingDriver.phone = d.phone || '';
    publicTrackingDriver.lat = ['ACCEPTED','ARRIVED','ON_TRIP'].includes(o.orderStatus) && d.lat !== '' ? number_(d.lat, NaN) : null;
    publicTrackingDriver.lng = ['ACCEPTED','ARRIVED','ON_TRIP'].includes(o.orderStatus) && d.lng !== '' ? number_(d.lng, NaN) : null;
    publicTrackingDriver.lastLocationAt = ['ACCEPTED','ARRIVED','ON_TRIP'].includes(o.orderStatus) ? d.lastLocationAt || '' : '';
  }
  return ok_({ order: safeOrder_(o), driver: publicTrackingDriver, events: events, settings: publicSettings_() });
}

/* ------------------------------ ADMIN ------------------------------ */

function adminLogin_(p) {
  if (String(p.username || '') !== ADMIN_USERNAME || String(p.password || '') !== ADMIN_PASSWORD) return fail_('Username atau kata sandi admin salah.');
  if (ADMIN_PASSWORD === 'CHANGE_THIS_BEFORE_DEPLOYMENT') return fail_('Atur ADMIN_PASSWORD unik di Code.gs sebelum menggunakan akun admin.');
  const token = createSession_('admin', 'ADMIN');
  return ok_({ token: token });
}

function adminDashboard_(p) {
  session_(p.token, 'admin');
  const drivers = records_(TABLES.DRIVERS).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const riders = records_(TABLES.RIDERS).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const audit = records_(TABLES.AUDIT).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 150);
  const orders = records_(TABLES.ORDERS).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 250);
  const payments = records_(TABLES.PAYMENTS).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 200);
  return ok_({
    drivers: drivers.map(safeDriver_), riders: riders.map(safeRider_), orders: orders.map(safeOrder_), payments: payments, audit: audit,
    withdrawals: records_(TABLES.WITHDRAWALS).sort((a,b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).slice(0, 200),
    settings: publicSettings_(),
    stats: {
      drivers: drivers.length,
      riders: riders.length,
      pendingDrivers: drivers.filter(d => d.status === 'PENDING').length,
      onlineDrivers: drivers.filter(d => d.status === 'APPROVED' && String(d.online) === 'true').length,
      orders: orders.length,
      activeOrders: orders.filter(o => ['REQUESTED','ACCEPTED','ARRIVED','ON_TRIP'].includes(o.orderStatus)).length,
      completedOrders: orders.filter(o => o.orderStatus === 'COMPLETED').length,
      grossRevenue: orders.filter(o => o.orderStatus === 'COMPLETED').reduce((sum,o) => sum + number_(o.fare,0), 0),
      pendingPayments: payments.filter(x => ['UNPAID','WAITING_CONFIRMATION'].includes(x.status)).length
    }
  });
}

function adminAction_(p) {
  session_(p.token, 'admin');
  const action = String(p.action || '');
  if (action === 'saveSettings') {
    const allowed = ['brand','defaultBaseFare','defaultFarePerKm','minimumFare','cancelFee','bankName','bankAccount','bankHolder','helpPhone','qrisImageUrl','qrisMerchantName'];
    const v = p.settings || {};
    allowed.forEach(k => {
      if (v[k] !== undefined) {
        let val = String(v[k]).trim();
        if (k === 'qrisImageUrl' && val && !/^https:\/\//i.test(val)) throw new Error('URL gambar QRIS harus menggunakan HTTPS.');
        if (['defaultBaseFare','defaultFarePerKm','minimumFare','cancelFee'].includes(k)) val = String(Math.max(0, Math.min(100000000, number_(val, 0))));
        upsertConfig_(k, val.substring(0, 180));
      }
    });
    auditAdmin_('saveSettings', 'CONFIG', 'GLOBAL', 'Pengaturan layanan diperbarui');
    return ok_({ settings: publicSettings_() });
  }
  if (action === 'riderStatus') {
    const rider = find_(TABLES.RIDERS, 'riderId', p.riderId);
    if (!rider) return fail_('Penumpang tidak ditemukan.');
    const next = String(p.status || '');
    if (!['ACTIVE','SUSPENDED'].includes(next)) return fail_('Status penumpang tidak valid.');
    update_(TABLES.RIDERS, rider._row, { status: next });
    auditAdmin_('riderStatus', 'RIDER', rider.riderId, 'Status penumpang diubah menjadi ' + next);
    return ok_({ updated: true });
  }
  if (action === 'driverStatus') {
    const d = find_(TABLES.DRIVERS, 'driverId', p.driverId);
    if (!d) return fail_('Driver tidak ditemukan.');
    const next = String(p.status || '');
    if (!['APPROVED','REJECTED','SUSPENDED'].includes(next)) return fail_('Status driver tidak valid.');
    if (next === 'APPROVED' && !d.identityDocFileId) return fail_('Dokumen identitas driver belum tersedia.');
    update_(TABLES.DRIVERS, d._row, { status: next, online: false, approvedAt: next === 'APPROVED' ? now_() : d.approvedAt });
    auditAdmin_('driverStatus', 'DRIVER', d.driverId, 'Status driver diubah menjadi ' + next);
    return ok_({ updated: true });
  }
  if (action === 'assignOrder') {
    const o = find_(TABLES.ORDERS, 'orderId', p.orderId);
    const d = find_(TABLES.DRIVERS, 'driverId', p.driverId);
    if (!o || !d) return fail_('Pesanan atau driver tidak ditemukan.');
    if (!['REQUESTED','DECLINED'].includes(o.orderStatus)) return fail_('Pesanan sudah berjalan dan tidak dapat dipindahkan.');
    if (d.status !== 'APPROVED') return fail_('Driver belum disetujui.');
    update_(TABLES.ORDERS, o._row, { driverId: d.driverId, driverName: d.name, orderStatus: 'REQUESTED', updatedAt: now_() });
    addEvent_(o.orderId, 'ADMIN', 'ADMIN', 'ASSIGNED', 'Admin menugaskan driver ' + d.name);
    auditAdmin_('assignOrder', 'ORDER', o.orderId, 'Driver ditugaskan: ' + d.name);
    return ok_({ assigned: true });
  }
  if (action === 'paymentConfirm') {
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const pay = find_(TABLES.PAYMENTS, 'paymentId', p.paymentId);
      if (!pay) return fail_('Data pembayaran tidak ditemukan.');
      const next = p.status === 'REJECTED' ? 'REJECTED' : 'PAID';
      if (pay.creditedAt && next !== 'PAID') return fail_('Pembayaran sudah dikreditkan ke saldo driver dan tidak dapat ditolak dari panel ini.');
      const paymentPatch = { status: next, updatedAt: now_() };
      if (p.reference) paymentPatch.reference = clean_(p.reference, 100);
      const o = find_(TABLES.ORDERS, 'orderId', pay.orderId);
      if (next === 'PAID' && o && o.orderStatus === 'COMPLETED' && o.paymentMethod !== 'CASH') {
        const credit = creditDriverWallet_(o, Object.assign({}, pay, { status: 'PAID' }));
        if (credit) paymentPatch.creditedAt = now_();
      }
      update_(TABLES.PAYMENTS, pay._row, paymentPatch);
      if (o) update_(TABLES.ORDERS, o._row, { paymentStatus: next, updatedAt: now_() });
      auditAdmin_('paymentConfirm', 'PAYMENT', pay.paymentId, 'Status pembayaran diubah menjadi ' + next);
      return ok_({ updated: true });
    } finally { lock.releaseLock(); }
  }
  if (action === 'withdrawalStatus') {
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try {
      const w = find_(TABLES.WITHDRAWALS, 'withdrawalId', p.withdrawalId);
      if (!w) return fail_('Permintaan penarikan tidak ditemukan.');
      if (w.status !== 'PENDING') return fail_('Permintaan ini sudah diproses.');
      const next = p.status === 'PAID' ? 'PAID' : 'REJECTED';
      const driver = find_(TABLES.DRIVERS, 'driverId', w.driverId);
      if (next === 'REJECTED' && driver) update_(TABLES.DRIVERS, driver._row, { balance: number_(driver.balance, 0) + number_(w.amount, 0) });
      update_(TABLES.WITHDRAWALS, w._row, { status: next, processedAt: now_(), adminNote: clean_(p.adminNote || '', 180) });
      auditAdmin_('withdrawalStatus', 'WITHDRAWAL', w.withdrawalId, 'Status penarikan menjadi ' + next);
      return ok_({ updated: true });
    } finally { lock.releaseLock(); }
  }
  if (action === 'cancelOrder') {
    const o = find_(TABLES.ORDERS, 'orderId', p.orderId);
    if (!o) return fail_('Pesanan tidak ditemukan.');
    if (['COMPLETED','CANCELLED'].includes(o.orderStatus)) return fail_('Pesanan sudah selesai atau dibatalkan.');
    update_(TABLES.ORDERS, o._row, { orderStatus: 'CANCELLED', cancelReason: clean_(p.reason || 'Dibatalkan admin', 180), updatedAt: now_() });
    addEvent_(o.orderId, 'ADMIN', 'ADMIN', 'CANCELLED', 'Pesanan dibatalkan oleh admin');
    auditAdmin_('cancelOrder', 'ORDER', o.orderId, 'Pesanan dibatalkan admin');
    return ok_({ updated: true });
  }
  return fail_('Aksi admin tidak dikenali.');
}

function auditAdmin_(action, targetType, targetId, detail) {
  append_(TABLES.AUDIT, { auditId: randomId_('AUD'), actor: 'ADMIN', action: clean_(action, 60), targetType: clean_(targetType, 40), targetId: clean_(targetId, 80), detail: clean_(detail, 240), createdAt: now_() });
}

/* ------------------------------ HELPERS ------------------------------ */

function publicDriver_(d) {
  if (!d) return null;
  return {
    driverId: d.driverId, name: d.name, vehicleType: d.vehicleType,
    vehicleBrand: d.vehicleBrand, plate: d.plate, region: d.region,
    online: String(d.online) === 'true', baseFare: number_(d.baseFare, 0),
    farePerKm: number_(d.farePerKm, 0), rating: number_(d.rating, 5),
    ratingCount: number_(d.ratingCount, 0)
  };
}

function safeDriver_(d) {
  if (!d) return null;
  return {
    driverId: d.driverId, name: d.name, phone: d.phone, email: d.email,
    vehicleType: d.vehicleType, vehicleBrand: d.vehicleBrand, plate: d.plate, region: d.region,
    status: d.status, online: String(d.online) === 'true',
    baseFare: number_(d.baseFare,0), farePerKm: number_(d.farePerKm,0),
    rating: number_(d.rating,5), ratingCount: number_(d.ratingCount,0), balance: number_(d.balance,0),
    lat: d.lat === '' ? null : number_(d.lat, NaN), lng: d.lng === '' ? null : number_(d.lng, NaN),
    lastLocationAt: d.lastLocationAt, createdAt: d.createdAt, approvedAt: d.approvedAt,
    emailVerified: String(d.emailVerified) === 'true', hasIdentityDocument: Boolean(d.identityDocFileId),
    identityDocType: d.identityDocType || '', identityDocFileName: d.identityDocFileName || '',
    payoutMethod: d.payoutMethod || '', payoutDetails: d.payoutDetails || '', payoutUpdatedAt: d.payoutUpdatedAt || ''
  };
}

function safeOrder_(o) {
  if (!o) return null;
  const out = {};
  HEADERS[TABLES.ORDERS].forEach(k => out[k] = o[k] === undefined ? '' : o[k]);
  return out;
}

function addEvent_(orderId, actorType, actorId, eventType, message) {
  append_(TABLES.EVENTS, {
    eventId: randomId_('EVT'), orderId: orderId, actorType: actorType, actorId: actorId,
    eventType: eventType, message: message, createdAt: now_()
  });
}

function now_() { return new Date().toISOString(); }
function ok_(data) { return Object.assign({ ok: true }, data || {}); }
function fail_(message) { return { ok: false, message: String(message || 'Permintaan gagal.') }; }
function clean_(v, max) { return String(v == null ? '' : v).replace(/[<>]/g, '').trim().substring(0, max || 200); }

function phone_(v) {
  let phone = String(v == null ? '' : v)
    .trim()
    .replace(/[^0-9+]/g, '');

  // Format internasional Indonesia menjadi format lokal.
  if (phone.startsWith('+62')) {
    phone = '0' + phone.substring(3);
  } else if (phone.startsWith('62')) {
    phone = '0' + phone.substring(2);
  }

  // Pulihkan angka 0 yang mungkin hilang akibat format Spreadsheet.
  if (/^8\d{8,12}$/.test(phone)) {
    phone = '0' + phone;
  }
  // Selalu simpan dalam bentuk string lokal 08..., bukan angka spreadsheet.

  return phone;
}

function number_(v, fallback) { const n = Number(v); return isFinite(n) ? n : fallback; }
function roundTo500_(n) { return Math.ceil(n / 500) * 500; }


function diagnoseDriverAccount(phone) {
  const target = phone_(phone);
  const drivers = records_(TABLES.DRIVERS);

  const d = drivers.find(function(x) {
    return phone_(x.phone) === target;
  });

  if (!d) {
    Logger.log('HASIL: DRIVER TIDAK DITEMUKAN');
    Logger.log('Nomor pencarian: ' + target);
    return;
  }

  Logger.log('HASIL: DRIVER DITEMUKAN');
  Logger.log('ID: ' + d.driverId);
  Logger.log('Nama: ' + d.name);
  Logger.log('Nomor tersimpan: ' + d.phone);
  Logger.log('Nomor normalisasi: ' + phone_(d.phone));
  Logger.log('Status: ' + d.status);
  Logger.log('Salt tersedia: ' + Boolean(d.passwordSalt));
  Logger.log('Hash tersedia: ' + Boolean(d.passwordHash));
  Logger.log('Panjang hash: ' + String(d.passwordHash || '').length);
}
