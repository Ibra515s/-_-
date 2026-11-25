const { createApp, seedAdmin } = require('../server/app');
const { connect } = require('../server/db');

let ready = false;
let readyPromise = null;

function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await connect();
      await seedAdmin();
      ready = true;
    })();
  }
  return readyPromise;
}

const app = createApp();

module.exports = async (req, res) => {
  if (!ready) {
    try {
      await ensureReady();
    } catch (err) {
      console.error('Vercel DB connection error:', err);
      return res.status(500).json({
        error: 'database_connection_failed',
        message: 'فشل الاتصال بقاعدة البيانات. تأكد من إضافة MONGODB_URI في Environment Variables على Vercel والتصريح من 0.0.0.0/0 في MongoDB Atlas.',
        details: err.message
      });
    }
  }

  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    res.on('error', reject);
    app(req, res);
  });
};
