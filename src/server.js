const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const { initDb } = require('./db');
const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const articleRoutes = require('./routes/articles');
const topicRoutes = require('./routes/topics');
const imageRoutes = require('./routes/images');
const { startScheduler } = require('./scheduler');

initDb();

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

app.set('view engine', 'ejs');
app.set('views', path.join(config.rootDir, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use('/public', express.static(path.join(config.rootDir, 'public')));
app.use('/storage/images', express.static(config.imageDir));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.dirname(config.dbPath) }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.brandName = config.brandName;
  res.locals.autoPublish = config.autoPublish;
  next();
});

app.use(authRoutes);
app.use(requireAuth);
app.use(dashboardRoutes);
app.use(articleRoutes);
app.use(topicRoutes);
app.use(imageRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: '404', message: '页面不存在' });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).render('error', { title: '出错了', message: error.message || '服务器错误' });
});

startScheduler();

app.listen(config.port, () => {
  console.log(`${config.brandName} admin listening on http://localhost:${config.port}`);
  console.log(`AUTO_PUBLISH=${config.autoPublish} (publishing endpoints are not implemented)`);
});
