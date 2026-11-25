const { createApp, seedAdmin, startBackgroundJobs } = require('./app');
const { PORT, MONGODB_DB } = require('./config');
const { connect, close } = require('./db');

(async () => {
  await connect();
  const seeded = await seedAdmin();
  startBackgroundJobs();
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`الخادم يعمل على المنفذ ${PORT} — قاعدة MongoDB: ${MONGODB_DB}`);
    if (seeded) {
      console.log('\n=== تم إنشاء حساب المشرف الرئيسي ===');
      console.log(`اسم المستخدم: ${seeded.username}`);
      if (seeded.generated) {
        console.log(`كلمة المرور المؤقتة: ${seeded.password}`);
        console.log('(ستُطلب منك كلمة مرور جديدة عند أول دخول. لن تُعرض هذه الكلمة مرة أخرى.)');
      } else {
        console.log('كلمة المرور: من متغير البيئة ADMIN_PASSWORD');
      }
      console.log('====================================\n');
    }
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); close().finally(() => process.exit(0)); });
})().catch((e) => { console.error('فشل الاتصال بقاعدة MongoDB:', e.message); process.exit(1); });
