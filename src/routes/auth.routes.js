/**
 * Hawasb Cafe POS - Authentication Routes
 * Bcrypt PIN verification with Cashier Concurrency Guard
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Allows:
 * 1. Anyone if zero shifts are open.
 * 2. The active shift's cashier to resume.
 * 3. The Owner/Admin to log in as supervisor/manager (without interfering with the shift).
 * Blocks:
 * Other cashiers from entering while someone else has an active shift running.
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
      return res.status(401).json({ error: 'لا يوجد مستخدمون نشطون في المنظومة' });
    }

    let matchedUser = null;
    const inputPin = String(pin).trim();

    for (const u of users) {
      if (!u.pin_hash) continue;

      if (u.pin_hash.startsWith('$2')) {
        try {
          const isMatch = await bcrypt.compare(inputPin, u.pin_hash);
          if (isMatch) {
            matchedUser = u;
            break;
          }
        } catch (bcryptErr) {
          console.error(`[Auth] Bcrypt compare error for user ${u.username}:`, bcryptErr.message);
        }
      } else if (u.pin_hash === inputPin) {
        const upgradedHash = await bcrypt.hash(inputPin, 10);
        await client.query('UPDATE users SET pin_hash = $1, updated_at = NOW() WHERE id = $2', [upgradedHash, u.id]);
        matchedUser = u;
        break;
      }
    }

    if (!matchedUser) {
      return res.status(401).json({ error: 'الرقم السري غير صحيح' });
    }

    if (!matchedUser.is_active) {
      return res.status(403).json({ error: 'هذا الحساب معطل حالياً. يرجى مراجعة المالك.' });
    }

    // Cashier Concurrency Guard: Check if an active shift is running
    const activeShiftRes = await client.query(
      `SELECT s.id, s.cashier_id, u.name as cashier_name 
       FROM shifts s 
       JOIN users u ON s.cashier_id = u.id 
       WHERE s.status IN ('open', 'pending_handover') 
       LIMIT 1`
    );

    if (activeShiftRes.rows.length > 0) {
      const activeShift = activeShiftRes.rows[0];

      // If a shift is open, other cashiers cannot log in until it is handed over
      // The shift's cashier and the Owner are allowed
      if (matchedUser.role !== 'owner' && matchedUser.id !== activeShift.cashier_id) {
        return res.status(403).json({
          error: `توجد وردية نشطة حالياً للشيفتاجي (${activeShift.cashier_name}). لا يمكن لشيفتاجي آخر تسجيل الدخول حتى يتم تسليم الوردية وإغلاقها.`,
        });
      }
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