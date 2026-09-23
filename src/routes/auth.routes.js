/**
 * Hawasb Cafe POS - Authentication Routes
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Standardized bcrypt-only PIN authentication
 */
router.post('/login', async (req, res) => {
  const { username, pin } = req.body;

  if (!pin || String(pin).trim() === '') {
    return res.status(400).json({ error: 'يرجى إدخال الرقم السري (PIN)' });
  }

  const client = await db.getClient();
  try {
    let usersQuery;
    let queryParams;

    if (username) {
      usersQuery = 'SELECT id, name, username, pin_hash, role, is_active FROM users WHERE username = $1';
      queryParams = [username];
    } else {
      usersQuery = 'SELECT id, name, username, pin_hash, role, is_active FROM users WHERE is_active = TRUE';
      queryParams = [];
    }

    const { rows: users } = await client.query(usersQuery, queryParams);

    if (users.length === 0) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    }

    let matchedUser = null;

    // Hardening Bug J: Strictly use bcrypt.compare - NEVER accept plaintext fallback
    for (const u of users) {
      if (u.pin_hash && u.pin_hash.startsWith('$2')) {
        const isMatch = await bcrypt.compare(String(pin), u.pin_hash);
        if (isMatch) {
          matchedUser = u;
          break;
        }
      }
    }

    if (!matchedUser) {
      return res.status(401).json({ error: 'الرقم السري غير صحيح' });
    }

    if (!matchedUser.is_active) {
      return res.status(403).json({ error: 'هذا الحساب معطل حالياً. يرجى مراجعة المالك.' });
    }

    const payload = {
      id: matchedUser.id,
      name: matchedUser.name,
      username: matchedUser.username,
      role: matchedUser.role,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });

    return res.json({
      message: 'تم تسجيل الدخول بنجاح',
      token,
      user: payload,
    });
  } catch (err) {
    console.error('[Auth Login Error]:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;