/**
 * Hawasb Cafe POS - Financial Reports & System Settings Management
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireOwner } = require('../middleware/auth');
const { SETTINGS_KEYS } = require('../config/constants');

/**
 * GET /api/finance/settings
 * Read current system settings
 */
router.get('/settings', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT key, value, description FROM settings`);
    const settingsMap = {};
    rows.forEach((r) => {
      settingsMap[r.key] = r.value;
    });
    return res.json(settingsMap);
  } catch (err) {
    console.error('[Get Settings Error]:', err);
    return res.status(500).json({ error: 'فشل في تحميل الإعدادات' });
  }
});

/**
 * PUT /api/finance/settings
 * Update system settings (e.g. commission rate, negative stock behavior)
 */
router.put('/settings', authenticateToken, requireOwner, async (req, res) => {
  const { commission_rate, commission_payment_methods, block_negative_stock, daily_fixed_cost } = req.body;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    if (commission_rate !== undefined) {
      await client.query(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
        [String(commission_rate), SETTINGS_KEYS.COMMISSION_RATE]
      );
    }
    if (commission_payment_methods !== undefined) {
      await client.query(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
        [String(commission_payment_methods), SETTINGS_KEYS.COMMISSION_PAYMENT_METHODS]
      );
    }
    if (block_negative_stock !== undefined) {
      await client.query(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
        [String(block_negative_stock), SETTINGS_KEYS.BLOCK_NEGATIVE_STOCK]
      );
    }
    if (daily_fixed_cost !== undefined) {
      await client.query(
        `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = $2`,
        [String(daily_fixed_cost), SETTINGS_KEYS.DAILY_FIXED_COST]
      );
    }

    await client.query('COMMIT');
    return res.json({ message: 'تم تحديث إعدادات النظام بنجاح' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Update Settings Error]:', err);
    return res.status(500).json({ error: 'فشل في تحديث الإعدادات' });
  } finally {
    client.release();
  }
});

module.exports = router;