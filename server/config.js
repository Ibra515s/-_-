const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (_) {}
}

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  FONT_DIR: path.join(__dirname, 'fonts'),
  PORT: Number(process.env.PORT) || 3000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  MONGODB_DB: process.env.MONGODB_DB || 'fajr',
  // اضبطه على 1 عند التشغيل خلف وسيط عكسي (أغلب الاستضافات)
  TRUST_PROXY: process.env.TRUST_PROXY || '',
  DEFAULT_TZ: process.env.APP_TIMEZONE || 'Asia/Amman',
  PARTICIPANT_SESSION_DAYS: 120,
  STAFF_SESSION_DAYS: 14,
};
