/**
 * Hawasb Cafe POS - Authentication & Authorization Middleware
 */

const jwt = require('jsonwebtoken');
const { ROLES } = require('../config/constants');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'جلسة العمل غير صالحة أو غير موجودة. يرجى تسجيل الدخول.' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'انتهت صلاحية جلسة العمل. يرجى إعادة تسجيل الدخول.' });
    }
    req.user = user;
    next();
  });
}

function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== ROLES.OWNER) {
    return res.status(403).json({ error: 'عذراً، هذه العملية مصرح بها للمالك فقط.' });
  }
  next();
}

function requireCashierOrOwner(req, res, next) {
  if (!req.user || (req.user.role !== ROLES.CASHIER && req.user.role !== ROLES.OWNER)) {
    return res.status(403).json({ error: 'غير مصرح بإجراء هذه العملية.' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireOwner,
  requireCashierOrOwner,
};