/**
 * Hawasb Cafe POS - Customer Accounts, Shakak Ledger & Profile History
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/debts
 * List all customer tabs, debt, and credit balances
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, phone, current_debt, credit_balance, is_owner 
       FROM customers 
       ORDER BY current_debt DESC, name ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[Get Debts Error]:', err);
    return res.status(500).json({ error: 'فشل في تحميل قائمة المديونيات' });
  }
});

/**
 * POST /api/debts/customers
 * Quick-add new customer for Shakak tabs (Cashier or Owner)
 */
router.post('/customers', authenticateToken, async (req, res) => {
  const { name, phone } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'اسم العميل مطلوب' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO customers (name, phone, current_debt, credit_balance, is_owner)
       VALUES ($1, $2, 0.00, 0.00, FALSE)
       RETURNING *`,
      [name.trim(), phone ? phone.trim() : null]
    );

    return res.status(201).json({
      message: 'تم تسجيل العميل بنجاح',
      customer: rows[0],
    });
  } catch (err) {
    console.error('[Create Customer Error]:', err);
    return res.status(500).json({ error: 'فشل في تسجيل العميل الجديد' });
  }
});

/**
 * GET /api/debts/:id/history
 * Comprehensive Customer Profile: Strictly loads CREDIT SHAKAK orders only
 */
router.get('/:id/history', authenticateToken, async (req, res) => {
  const custId = parseInt(req.params.id, 10);

  if (isNaN(custId)) {
    return res.status(400).json({ error: 'معرف العميل غير صالح' });
  }

  try {
    const custRes = await db.query(
      `SELECT id, name, phone, current_debt, credit_balance, is_owner, created_at 
       FROM customers WHERE id = $1`,
      [custId]
    );

    if (custRes.rows.length === 0) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }

    // STRICT FILTER: Only load orders taken as credit_shakak
    const ordersRes = await db.query(
      `SELECT o.id, o.shift_id, o.payment_method, o.subtotal, o.created_at, o.device_tab_name,
              json_agg(json_build_object('item_name', i.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'total_price', oi.total_price)) as items
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN items i ON oi.item_id = i.id
       WHERE o.customer_id = $1 
         AND o.status != 'cancelled'
         AND o.payment_method = 'credit_shakak'
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 30`,
      [custId]
    );

    // Payments made by customer
    const paymentsRes = await db.query(
      `SELECT dp.id, dp.amount_paid, dp.debt_cleared, dp.credit_added, dp.payment_method, dp.notes, dp.created_at,
              u.name as cashier_name
       FROM debt_payments dp
       JOIN users u ON dp.cashier_id = u.id
       WHERE dp.customer_id = $1
       ORDER BY dp.created_at DESC
       LIMIT 30`,
      [custId]
    );

    return res.json({
      customer: custRes.rows[0],
      orders: ordersRes.rows,
      payments: paymentsRes.rows,
    });
  } catch (err) {
    console.error('[Get Customer History Error]:', err);
    return res.status(500).json({ error: 'فشل في استخراج كشف حساب العميل' });
  }
});

/**
 * POST /api/debts/pay
 * Full or partial debt claim/payment
 */
router.post('/pay', authenticateToken, async (req, res) => {
  const { customer_id, amount, payment_method, notes } = req.body;

  const paymentAmount = parseFloat(amount);
  const custId = parseInt(customer_id, 10);

  if (isNaN(custId) || isNaN(paymentAmount) || paymentAmount <= 0) {
    return res.status(400).json({ error: 'بيانات المبلغ أو العميل غير صالحة' });
  }

  const client = await db.getClient();
  let inTransaction = false;

  try {
    const custRes = await client.query(
      `SELECT id, name, current_debt, credit_balance FROM customers WHERE id = $1 FOR UPDATE`,
      [custId]
    );

    if (custRes.rows.length === 0) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }

    const customer = custRes.rows[0];
    const currentDebt = Number(customer.current_debt || 0);
    const currentCredit = Number(customer.credit_balance || 0);

    const shiftRes = await client.query(`SELECT id FROM shifts WHERE status = 'open' LIMIT 1`);
    const activeShiftId = shiftRes.rows.length > 0 ? shiftRes.rows[0].id : null;

    await client.query('BEGIN');
    inTransaction = true;

    let debtCleared = 0.00;
    let creditAdded = 0.00;
    let newDebt = 0.00;
    let newCredit = currentCredit;

    if (paymentAmount <= currentDebt) {
      debtCleared = paymentAmount;
      newDebt = Number((currentDebt - paymentAmount).toFixed(2));
    } else {
      debtCleared = currentDebt;
      creditAdded = Number((paymentAmount - currentDebt).toFixed(2));
      newDebt = 0.00;
      newCredit = Number((currentCredit + creditAdded).toFixed(2));
    }

    await client.query(
      `UPDATE customers 
       SET current_debt = $1, credit_balance = $2, updated_at = NOW() 
       WHERE id = $3`,
      [newDebt, newCredit, custId]
    );

    const paymentLogRes = await client.query(
      `INSERT INTO debt_payments 
        (customer_id, shift_id, cashier_id, amount_paid, debt_cleared, credit_added, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        custId,
        activeShiftId,
        req.user.id,
        paymentAmount,
        debtCleared,
        creditAdded,
        payment_method || 'cash',
        notes || (creditAdded > 0 ? `سداد مع إضافة رصيد دائن قدره ${creditAdded} ج.م` : 'سداد مديونية شكك'),
      ]
    );

    await client.query('COMMIT');
    inTransaction = false;

    return res.json({
      message: creditAdded > 0
        ? `تم سداد كامل المديونية بنجاح وإضافة رصيد دائن بقيمة ${creditAdded} ج.م`
        : `تم تحصيل مبلغ ${paymentAmount} ج.م بنجاح. المتبقي: ${newDebt} ج.م`,
      payment: paymentLogRes.rows[0],
      customer: {
        id: custId,
        name: customer.name,
        previous_debt: currentDebt,
        new_debt: newDebt,
        credit_balance: newCredit,
      },
    });
  } catch (err) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rb) {}
    }
    console.error('[Pay Debt Error]:', err);
    return res.status(500).json({ error: 'فشل في تسجيل عملية السداد' });
  } finally {
    client.release();
  }
});

module.exports = router;