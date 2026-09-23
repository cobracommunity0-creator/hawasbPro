/**
 * Hawasb Cafe POS - Personal Staff & Owner Consumption Routes
 * Corrects Business Rules 2 & 3: Staff charged at COST; Owner exempt from all charges.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { deductSingleItemStock } = require('../services/costEngine');

/**
 * POST /api/consumptions
 * Records personal consumption, charges staff at COST, owner at 0 (Bug H)
 */
router.post('/', authenticateToken, async (req, res) => {
  const { item_id, quantity, customer_id, is_owner, notes } = req.body;

  const qty = parseFloat(quantity);
  const itemId = parseInt(item_id, 10);

  if (isNaN(itemId) || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'بيانات الصنف أو الكمية غير صالحة' });
  }

  const client = await db.getClient();
  let inTransaction = false;

  try {
    // 1. Check for Active Open Shift
    const shiftRes = await client.query(
      `SELECT id FROM shifts WHERE status = 'open' LIMIT 1`
    );
    if (shiftRes.rows.length === 0) {
      return res.status(400).json({ error: 'لا توجد وردية مفتوحة لتسجيل الاستهلاك عليها' });
    }
    const shiftId = shiftRes.rows[0].id;

    await client.query('BEGIN');
    inTransaction = true;

    // 2. Fetch and Deduct Item Stock
    const deduction = await deductSingleItemStock(client, itemId, qty);
    const unitCost = deduction.unitCost;

    // 3. Determine Pricing according to Business Rules 2 & 3
    let priceCharged = 0.00;
    let isOwnerConsumption = Boolean(is_owner);

    if (customer_id) {
      const custRes = await client.query(
        `SELECT id, name, is_owner, current_debt FROM customers WHERE id = $1 FOR UPDATE`,
        [customer_id]
      );
      if (custRes.rows.length > 0) {
        if (custRes.rows[0].is_owner) {
          isOwnerConsumption = true;
        }
      }
    }

    if (isOwnerConsumption) {
      // Business Rule 3: Owner is exempt from all charges; recorded at cost for inventory only
      priceCharged = 0.00;
    } else {
      // Business Rule 2: Staff personal consumption charged at COST price, NOT selling price
      priceCharged = Number((unitCost * qty).toFixed(2));

      // Charge to customer debt tab if customer_id provided
      if (customer_id) {
        await client.query(
          `UPDATE customers 
           SET current_debt = current_debt + $1, updated_at = NOW() 
           WHERE id = $2`,
          [priceCharged, customer_id]
        );
      }
    }

    // 4. Insert Consumption Record
    const insertRes = await client.query(
      `INSERT INTO consumptions 
        (shift_id, cashier_id, consumer_user_id, customer_id, item_id, quantity, unit_cost, price_charged, is_owner, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        shiftId,
        req.user.id,
        req.user.id,
        customer_id || null,
        itemId,
        qty,
        unitCost,
        priceCharged,
        isOwnerConsumption,
        notes || null,
      ]
    );

    await client.query('COMMIT');
    inTransaction = false;

    return res.status(201).json({
      message: isOwnerConsumption
        ? 'تم تسجيل استهلاك المالك بنجاح (معفى من الرسوم)'
        : 'تم تسجيل استهلاك الموظف بسعر التكلفة بنجاح',
      consumption: insertRes.rows[0],
    });
  } catch (err) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rb) {}
    }
    console.error('[Consumption Error]:', err);
    return res.status(400).json({ error: err.message || 'فشل في تسجيل الاستهلاك' });
  } finally {
    client.release();
  }
});

module.exports = router;