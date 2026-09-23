/**
 * Hawasb Cafe POS - Debts & Shakak Repayments Routes
 * Handles overpayments explicitly as customer credit balance (Bug L)
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/debts
 * List customers with outstanding debt or credit balances
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
 * POST /api/debts/pay
 * Debt repayment with explicit overpayment tracking (Bug L)
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

    // Active shift verification
    const shiftRes = await client.query(`SELECT id FROM shifts WHERE status = 'open' LIMIT 1`);
    const activeShiftId = shiftRes.rows.length > 0 ? shiftRes.rows[0].id : null;

    await client.query('BEGIN');
    inTransaction = true;

    let debtCleared = 0.00;
    let creditAdded = 0.00;
    let newDebt = 0.00;
    let newCredit = currentCredit;

    // Bug L: Track overpayments explicitly into customer credit balance
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
        notes || (creditAdded > 0 ? `سداد مع إضافة رصيد دائن قدره ${creditAdded} ج.م` : 'سداد مديونية'),
      ]
    );

    await client.query('COMMIT');
    inTransaction = false;

    return res.json({
      message: creditAdded > 0
        ? `تم سداد كامل المديونية وإيداع مبلغ إضافي (${creditAdded} ج.م) كرصيد دائن للعميل`
        : 'تم تسجيل سداد المديونية بنجاح',
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