const cron = require('node-cron');
const config = require('./config');
const { db } = require('./db');

function startScheduler() {
  cron.schedule('0 9 * * *', () => {
    const status = config.autoPublish ? 'blocked' : 'ok';
    const message = config.autoPublish
      ? 'AUTO_PUBLISH 被配置为 true，但当前版本不支持自动发布，已阻断。'
      : '每日任务检查完成：当前仅 dry-run，不自动发布。';

    db.prepare('INSERT INTO task_logs (task_name, status, message) VALUES (?, ?, ?)')
      .run('daily_check', status, message);
  });
}

module.exports = { startScheduler };
