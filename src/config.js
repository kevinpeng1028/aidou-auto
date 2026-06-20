const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.idol'), override: true });

const rootDir = process.cwd();

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

const config = {
  rootDir,
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me',
  brandName: process.env.BRAND_NAME || '爱豆加油站',
  autoPublish: boolEnv(process.env.AUTO_PUBLISH, false),
  dbPath: path.resolve(rootDir, process.env.DATABASE_PATH || 'storage/app.sqlite'),
  imageDir: path.resolve(rootDir, 'storage/images'),
  exportDir: path.resolve(rootDir, 'storage/exports'),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
};

module.exports = config;
