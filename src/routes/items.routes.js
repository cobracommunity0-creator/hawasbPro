/**
 * Hawasb Cafe POS - Items & Inventory Management Routes
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireOwner } = require('../middleware/auth');

/**
 * GET /api/items
 * Returns all active items, inventory, and categories
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, category, price, cost_price, current_stock, track_in_handover, is_active,
              (current_stock < 0) as is_negative_stock
       FROM items 
       WHERE is_active = TRUE 
       ORDER BY category ASC, name ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[Get Items Error]:', err);
    return res.status(500).json({ error: 'فشل في تحميل قائمة الأصناف' });
  }
});

/**
 * POST /api/items
 * Create new menu item (Owner only)
 */
router.post('/', authenticateToken, requireOwner, async (req, res) => {
  const { name, category, price, cost_price, current_stock, track_in_handover } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ error: 'اسم الصنف وسعر البيع مطلوبان' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO items (name, category, price, cost_price, current_stock, track_in_handover)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        name.trim(),
        category || 'عام',
        parseFloat(price) || 0.00,
        parseFloat(cost_price) || 0.00,
        parseFloat(current_stock) || 0.00,
        track_in_handover !== undefined ? Boolean(track_in_handover) : true,
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[Create Item Error]:', err);
    return res.status(500).json({ error: 'فشل في إضافة الصنف الجديد' });
  }
});

module.exports = router;