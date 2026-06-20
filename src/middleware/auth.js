const config = require('../config');

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

function verifyCredentials(username, password) {
  return username === config.adminUsername && password === config.adminPassword;
}

module.exports = { requireAuth, verifyCredentials };
