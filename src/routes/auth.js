const express = require('express');
const { verifyCredentials } = require('../middleware/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { title: '登录', error: '' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!verifyCredentials(username, password)) {
    return res.status(401).render('login', { title: '登录', error: '用户名或密码不正确' });
  }

  req.session.user = { username };
  return res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
