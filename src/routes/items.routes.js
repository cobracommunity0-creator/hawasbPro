/**
 * Hawasb Cafe POS - Items & Inventory CRUD Management Routes (Owner Only)
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireOwner } = require('../middleware/auth');

/**
 * GET /api/items
 * List active items for POS screen and inventory checks
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
      `INSERT INTO items (name, category, price, cost_price, current_stock, track_in_handover, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING *`,
      [
        name.trim(),
        category ? category.trim() : 'عام',
        parseFloat(price) || 0.00,
        parseFloat(cost_price) || 0.00,
        parseFloat(current_stock) || 0.00,
        track_in_handover !== undefined ? Boolean(track_in_handover) : true,
      ]
    );
    return res.status(201).json({ message: 'تمت إضافة الصنف بنجاح', item: rows[0] });
  } catch (err) {
    console.error('[Create Item Error]:', err);
    return res.status(500).json({ error: 'فشل في إضافة الصنف الجديد' });
  }
});

/**
 * PUT /api/items/:id
 * Update existing item details, prices, or actual stock count (Owner only)
 */
router.put('/:id', authenticateToken, requireOwner, async (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const { name, category, price, cost_price, current_stock, track_in_handover } = req.body;

  if (isNaN(itemId)) {
    return res.status(400).json({ error: 'معرف الصنف غير صالح' });
  }

  try {
    const { rows } = await db.query(
      `UPDATE items 
       SET name = COALESCE($1, name),
           category = COALESCE($2, category),
           price = COALESCE($3, price),
           cost_price = COALESCE($4, cost_price),
           current_stock = COALESCE($5, current_stock),
           track_in_handover = COALESCE($6, track_in_handover),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        name ? name.trim() : null,
        category ? category.trim() : null,
        price !== undefined ? parseFloat(price) : null,
        cost_price !== undefined ? parseFloat(cost_price) : null,
        current_stock !== undefined ? parseFloat(current_stock) : null,
        track_in_handover !== undefined ? Boolean(track_in_handover) : null,
        itemId,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'الصنف المطلوب غير موجود' });
    }

    return res.json({ message: 'تم تعديل بيانات الصنف بنجاح', item: rows[0] });
  } catch (err) {
    console.error('[Update Item Error]:', err);
    return res.status(500).json({ error: 'فشل في تحديث بيانات الصنف' });
  }
});

/**
 * DELETE /api/items/:id
 * Soft delete (deactivate) an item (Owner only)
 */
router.delete('/:id', authenticateToken, requireOwner, async (req, res) => {
  const itemId = parseInt(req.params.id, 10);

  if (isNaN(itemId)) {
    return res.status(400).json({ error: 'معرف الصنف غير صالح' });
  }

  try {
    const { rows } = await db.query(
      `UPDATE items SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, name`,
      [itemId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'الصنف غير موجود' });
    }

    return res.json({ message: `تم حذف الصنف "${rows[0].name}" من القائمة بنجاح` });
  } catch (err) {
    console.error('[Delete Item Error]:', err);
    return res.status(500).json({ error: 'فشل في حذف الصنف' });
  }
});

module.exports = router;