const { createApp, seedAdmin } = require('../server/app');
const { connect } = require('../server/db');

let appInstance = null;
let initPromise = null;

async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await connect();
      await seedAdmin();
      return createApp();
    })();
  }
  return initPromise;
}

module.exports = async (req, res) => {
  try {
    if (!appInstance) {
      appInstance = await init();
    }
    return appInstance(req, res);
  } catch (err) {
    console.error('Vercel serverless init error:', err);
    res.status(500).json({
      error: 'database_connection_failed',
      message: 'تعذر الاتصال بقاعدة البيانات. تأكد من إضافة MONGODB_URI في Environment Variables على Vercel وتصريح الاتصال 0.0.0.0/0 في MongoDB Atlas.',
      details: err.message
    });
  }
};
