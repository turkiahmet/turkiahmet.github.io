/** Private, owner-run Apps Script. No web app and no public doGet/doPost entry point. */
const NOTIFICATION_RECIPIENT = 'turkiahmet26@gmail.com';
const NOTIFICATION_SERVICE = 'https://turkiahmet-admin.turkiahmet26.workers.dev/api/notifications/summary';
const NOTIFICATION_DASHBOARD = 'https://turkiahmet-admin.turkiahmet26.workers.dev/admin#inbox';
const NOTIFICATION_LOCAL_CAP = 90;
const NOTIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

function notificationInteger_(value, label) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('قيمة غير صالحة: ' + label);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('قيمة غير صالحة: ' + label);
  return number;
}

function notificationSummary_(properties, after) {
  const token = properties.getProperty('TOKEN');
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error('لم يكتمل حفظ مفتاح التنبيهات الخاص.');
  let response;
  try {
    response = UrlFetchApp.fetch(NOTIFICATION_SERVICE + '?after=' + encodeURIComponent(String(after)), {
      method: 'get',
      headers: {Authorization: 'Bearer ' + token, Accept: 'application/json', 'Cache-Control': 'no-store'},
      followRedirects: false,
      muteHttpExceptions: true,
      validateHttpsCertificates: true
    });
  } catch (error) {
    throw new Error('تعذر الاتصال بخدمة التنبيهات؛ لم يتغير مؤشر الإرسال.');
  }
  if (response.getResponseCode() !== 200) throw new Error('لم تقبل خدمة التنبيهات الطلب؛ راجع الإعدادات دون مشاركة المفتاح.');
  let summary;
  try { summary = JSON.parse(response.getContentText()); } catch (error) { throw new Error('استجابة التنبيهات غير صالحة.'); }
  if (!summary || typeof summary !== 'object' || Array.isArray(summary) ||
      Object.keys(summary).some(key => !['sequence', 'pending', 'latestAt'].includes(key)) ||
      !Number.isSafeInteger(summary.sequence) || summary.sequence < after ||
      !Number.isSafeInteger(summary.pending) || summary.pending !== summary.sequence - after ||
      (summary.latestAt !== null && (typeof summary.latestAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(summary.latestAt)))) {
    throw new Error('استجابة التنبيهات غير صالحة؛ لم يتغير مؤشر الإرسال.');
  }
  return summary;
}

/** Run once before creating the five-minute trigger; deliberately skips earlier arrivals without sending. */
function initializeBaseline() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('يوجد تشغيل آخر؛ حاول لاحقًا.');
  try {
    const properties = PropertiesService.getScriptProperties();
    const summary = notificationSummary_(properties, 0);
    properties.setProperty('LAST_SEQUENCE', String(summary.sequence));
    return {initialized: true, sequence: summary.sequence};
  } finally {
    lock.releaseLock();
  }
}

/** Configure this function from Apps Script's Triggers UI; creating triggers in code would require another scope. */
function notifyNewVisitorMessages() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {sent: false, reason: 'busy'};
  try {
    const properties = PropertiesService.getScriptProperties();
    const after = notificationInteger_(properties.getProperty('LAST_SEQUENCE'), 'نقطة البدء؛ شغّل initializeBaseline أولًا');
    const summary = notificationSummary_(properties, after);
    if (!summary.pending) return {sent: false, reason: 'no_new_messages'};

    const now = Date.now();
    const savedStart = properties.getProperty('WINDOW_STARTED_AT');
    const savedCount = properties.getProperty('WINDOW_SEND_COUNT');
    let start = savedStart === null ? now : notificationInteger_(savedStart, 'بداية الحصة المحلية');
    let count = savedCount === null ? 0 : notificationInteger_(savedCount, 'عدد التنبيهات المحلية');
    if ((savedStart === null) !== (savedCount === null) || now < start) throw new Error('يحتاج سجل الحصة المحلية إلى مراجعة.');
    if (now - start >= NOTIFICATION_WINDOW_MS) { start = now; count = 0; }
    if (count >= NOTIFICATION_LOCAL_CAP || MailApp.getRemainingDailyQuota() < 1) return {sent: false, reason: 'quota'};

    MailApp.sendEmail({
      to: NOTIFICATION_RECIPIENT,
      subject: 'رسائل جديدة من زوار موقعك الأكاديمي',
      body: 'عدد الرسائل الجديدة منذ آخر تنبيه: ' + summary.pending + '\n\nلقراءتها، افتح لوحة التحكم الخاصة:\n' + NOTIFICATION_DASHBOARD,
      name: 'تنبيهات الموقع الأكاديمي'
    });
    // A failed save here may cause a duplicate notification next time, but never discards a visitor message.
    properties.setProperties({
      LAST_SEQUENCE: String(summary.sequence),
      WINDOW_STARTED_AT: String(start),
      WINDOW_SEND_COUNT: String(count + 1)
    }, false);
    return {sent: true, count: summary.pending, sequence: summary.sequence};
  } finally {
    lock.releaseLock();
  }
}
