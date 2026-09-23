/**
 * Hawasb Cafe POS - Checkout & Orders Routes
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { deductSingleItemStock } = require('../services/costEngine');
const { PAYMENT_METHODS } = require('../config/constants');

/**
 * POST /api/orders/checkout
 * Fully audited for client leak prevention (Bug A) and double-submission protection (Bug B)
 */
router.post('/checkout', authenticateToken, async (req, res) => {
  const {
    cart,
    payment_method,
    customer_id,
    idempotency_key,
    device_tab_name,
    discount,
  } = req.body;

  const client = await db.getClient();
  let inTransaction = false;

  try {
    // 1. Validation Checks (before starting transaction)
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: 'سلة المشتريات فارغة' });
    }

    const validMethods = Object.values(PAYMENT_METHODS);
    if (!payment_method || !validMethods.includes(payment_method)) {
      return res.status(400).json({ error: 'طريقة الدفع المحددة غير صالحة' });
    }

    // 2. Idempotency Key Duplicate Check
    if (idempotency_key) {
      const existingOrderRes = await client.query(
        `SELECT id, shift_id, cashier_id, customer_id, payment_method, subtotal, total_cost, created_at 
         FROM orders 
         WHERE idempotency_key = $1`,
        [idempotency_key]
      );

      if (existingOrderRes.rows.length > 0) {
        // Return existing order without re-processing or leaking client
        return res.status(200).json({
          message: 'تم استرجاع الطلب المسجل مسبقاً بنجاح (حماية من التكرار)',
          order: existingOrderRes.rows[0],
          is_duplicate: true,
        });
      }
    }

    // 3. Verify Active Open Shift
    const shiftRes = await client.query(
      `SELECT id, status, cashier_id FROM shifts WHERE status = 'open' LIMIT 1`
    );

    if (shiftRes.rows.length === 0) {
      return res.status(400).json({ error: 'لا توجد وردية مفتوحة حالياً بالمنظومة. يرجى فتح وردية أولاً.' });
    }

    const currentShift = shiftRes.rows[0];

    // 4. Begin Multi-Statement Transaction
    await client.query('BEGIN');
    inTransaction = true;

    let subtotal = 0.00;
    let totalOrderCost = 0.00;
    const processedItems = [];

    // 5. Process cart items and deduct inventory
    for (const item of cart) {
      const itemId = parseInt(item.id, 10);
      const qty = parseFloat(item.quantity);

      if (isNaN(itemId) || isNaN(qty) || qty <= 0) {
        throw new Error('بيانات أحد الأصناف في السلة غير صحيحة');
      }

      // Deduct stock using cost engine
      const deduction = await deductSingleItemStock(client, itemId, qty);

      const itemTotalPrice = Number((deduction.unitPrice * qty).toFixed(2));
      const itemTotalCost = Number((deduction.unitCost * qty).toFixed(2));

      subtotal += itemTotalPrice;
      totalOrderCost += itemTotalCost;

      processedItems.push({
        item_id: itemId,
        quantity: qty,
        unit_price: deduction.unitPrice,
        unit_cost: deduction.unitCost,
        total_price: itemTotalPrice,
        total_cost: itemTotalCost,
      });
    }

    subtotal = Number(subtotal.toFixed(2));
    totalOrderCost = Number(totalOrderCost.toFixed(2));
    const finalDiscount = Number(discount && !isNaN(discount) ? parseFloat(discount).toFixed(2) : 0.00);
    let netDue = Number((subtotal - finalDiscount).toFixed(2));
    if (netDue < 0) netDue = 0.00;

    let creditApplied = 0.00;

    // 6. Handle Customer Account & Credit Shakak (Bug F & L)
    let validatedCustomerId = null;

    if (customer_id) {
      const custRes = await client.query(
        `SELECT id, name, current_debt, credit_balance, is_owner FROM customers WHERE id = $1 FOR UPDATE`,
        [customer_id]
      );

      if (custRes.rows.length > 0) {
        const customer = custRes.rows[0];
        validatedCustomerId = customer.id;

        // If Shakak (credit debt tab)
        if (payment_method === PAYMENT_METHODS.CREDIT_SHAKAK) {
          // If customer is marked as owner (Business Rule 3: Owner is exempt)
          if (customer.is_owner) {
            netDue = 0.00; // Owner never charged
          } else {
            // Apply customer credit balance if available (Bug L)
            const availableCredit = Number(customer.credit_balance || 0);
            if (availableCredit > 0) {
              if (availableCredit >= netDue) {
                creditApplied = netDue;
                const remainingCredit = Number((availableCredit - netDue).toFixed(2));
                netDue = 0.00;
                await client.query(
                  `UPDATE customers SET credit_balance = $1, updated_at = NOW() WHERE id = $2`,
                  [remainingCredit, customer.id]
                );
              } else {
                creditApplied = availableCredit;
                netDue = Number((netDue - availableCredit).toFixed(2));
                await client.query(
                  `UPDATE customers SET credit_balance = 0.00, updated_at = NOW() WHERE id = $2`,
                  [customer.id]
                );
              }
            }

            // Remaining netDue added to customer current_debt
            if (netDue > 0) {
              const newDebt = Number((Number(customer.current_debt || 0) + netDue).toFixed(2));
              await client.query(
                `UPDATE customers SET current_debt = $1, updated_at = NOW() WHERE id = $2`,
                [newDebt, customer.id]
              );
            }
          }
        }
      }
    } else if (payment_method === PAYMENT_METHODS.CREDIT_SHAKAK) {
      throw new Error('يجب تحديد العميل عند اختيار طريقة الدفع (شكك)');
    }

    // 7. Insert Order
    const insertOrderRes = await client.query(
      `INSERT INTO orders 
        (shift_id, cashier_id, customer_id, payment_method, subtotal, total_cost, discount, credit_applied, idempotency_key, device_tab_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed')
       RETURNING *`,
      [
        currentShift.id,
        req.user.id,
        validatedCustomerId,
        payment_method,
        subtotal,
        totalOrderCost,
        finalDiscount,
        creditApplied,
        idempotency_key || null,
        device_tab_name || null,
      ]
    );

    const createdOrder = insertOrderRes.rows[0];

    // 8. Insert Order Items
    for (const oi of processedItems) {
      await client.query(
        `INSERT INTO order_items 
          (order_id, item_id, quantity, unit_price, unit_cost, total_price, total_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          createdOrder.id,
          oi.item_id,
          oi.quantity,
          oi.unit_price,
          oi.unit_cost,
          oi.total_price,
          oi.total_cost,
        ]
      );
    }

    // 9. Commit Transaction
    await client.query('COMMIT');
    inTransaction = false;

    return res.status(201).json({
      message: 'تم إتمام البيع وتسجيل الطلب بنجاح',
      order: createdOrder,
      items: processedItems,
    });
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {
        console.error('[Rollback Error]:', rbErr);
      }
    }
    console.error('[Checkout Error]:', error);
    return res.status(400).json({ error: error.message || 'فشل في إتمام عملية البيع' });
  } finally {
    // Guarantees release across all return/throw paths (Bug A)
    client.release();
  }
});

module.exports = router;