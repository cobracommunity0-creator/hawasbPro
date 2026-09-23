/**
 * Hawasb Cafe POS - Shifts, Reports & Live Stats Routes
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireOwner } = require('../middleware/auth');
const { getShiftReport } = require('../services/shiftReportService');
const { SHIFT_STATUS, SETTINGS_KEYS } = require('../config/constants');

/**
 * GET /api/shifts
 * List all past and present shifts for admin reports review
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.cashier_id, u.name as cashier_name, s.start_time, s.end_time,
              s.starting_cash, s.closing_cash_actual, s.closing_cash_expected, s.cash_discrepancy,
              s.total_sales, s.net_profit, s.commission_earned, s.status, s.notes
       FROM shifts s
       JOIN users u ON s.cashier_id = u.id
       ORDER BY s.id DESC
       LIMIT 50`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[Get Shifts History Error]:', err);
    return res.status(500).json({ error: 'فشل في جلب سجل الورديات' });
  }
});

/**
 * GET /api/shifts/cashiers
 * List available cashiers for selection during handover
 */
router.get('/cashiers', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, username, role FROM users WHERE is_active = TRUE ORDER BY id ASC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[Get Cashiers Error]:', err);
    return res.status(500).json({ error: 'فشل في استرجاع قائمة الشيفتاجية' });
  }
});

/**
 * GET /api/shifts/current
 * Returns the currently active shift (open or pending_handover)
 */
router.get('/current', authenticateToken, async (req, res) => {
  try {
    const shiftRes = await db.query(
      `SELECT s.*, u.name as cashier_name 
       FROM shifts s 
       JOIN users u ON s.cashier_id = u.id 
       WHERE s.status IN ('open', 'pending_handover') 
       ORDER BY s.id DESC LIMIT 1`
    );

    if (shiftRes.rows.length === 0) {
      return res.json({ active: false, shift: null });
    }

    return res.json({ active: true, shift: shiftRes.rows[0] });
  } catch (err) {
    console.error('[Get Current Shift Error]:', err);
    return res.status(500).json({ error: 'فشل في استرجاع بيانات الوردية الحالية' });
  }
});

/**
 * GET /api/shifts/current/live-stats
 * Real-time stats for the cashier: cash drawer sales, commission, and restocking fund
 */
router.get('/current/live-stats', authenticateToken, async (req, res) => {
  try {
    const shiftRes = await db.query(
      `SELECT id FROM shifts WHERE status = 'open' LIMIT 1`
    );

    if (shiftRes.rows.length === 0) {
      return res.json({ active: false, stats: null });
    }

    const report = await getShiftReport(shiftRes.rows[0].id);

    return res.json({
      active: true,
      shift_id: shiftRes.rows[0].id,
      stats: {
        cash_sales: report.sales.cash_sales,
        cashier_commission_earned: report.commission.earned,
        restocking_cogs_reserve: report.drawer_split.restocking_cogs_reserve,
        starting_cash: report.cash_drawer.starting_cash,
        cash_debt_collected: report.sales.debt_collected_cash,
        drawer_expected: report.cash_drawer.closing_cash_expected,
      },
    });
  } catch (err) {
    console.error('[Get Live Stats Error]:', err);
    return res.status(500).json({ error: 'فشل في حساب الإحصائيات الفورية' });
  }
});

/**
 * POST /api/shifts/open
 * Explicitly opens a new shift (Requires cashier to click "+ فتح وردية جديدة")
 */
router.post('/open', authenticateToken, async (req, res) => {
  const { starting_cash, notes } = req.body;
  const initialCash = parseFloat(starting_cash);

  if (isNaN(initialCash) || initialCash < 0) {
    return res.status(400).json({ error: 'يرجى إدخال مبلغ نقدية بداية الوردية بشكل صحيح' });
  }

  const client = await db.getClient();
  try {
    const existingActive = await client.query(
      `SELECT id, status FROM shifts WHERE status IN ('open', 'pending_handover') LIMIT 1`
    );

    if (existingActive.rows.length > 0) {
      return res.status(400).json({
        error: `توجد وردية نشطة بالفعل (رقم #${existingActive.rows[0].id}). يجب إغلاقها أو تسليمها أولاً.`,
      });
    }

    const rateSetting = await client.query(
      `SELECT value FROM settings WHERE key = $1`,
      [SETTINGS_KEYS.COMMISSION_RATE]
    );
    const commissionRate = rateSetting.rows.length > 0 ? parseFloat(rateSetting.rows[0].value) : 0.10;

    const newShiftRes = await client.query(
      `INSERT INTO shifts (cashier_id, starting_cash, commission_rate, status, notes)
       VALUES ($1, $2, $3, 'open', $4)
       RETURNING *`,
      [req.user.id, initialCash, commissionRate, notes || null]
    );

    return res.status(201).json({
      message: 'تم فتح الوردية بنجاح',
      shift: newShiftRes.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'عذراً، توجد وردية نشطة مفتوحة بالفعل بالنظام ولا يمكن تكرارها.' });
    }
    console.error('[Open Shift Error]:', err);
    return res.status(500).json({ error: 'فشل في فتح الوردية' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/shifts/:id/accept-handover
 * Direct Handover Acceptance endpoint:
 * Strictly CLOSES the shift. NEVER creates an open shift automatically.
 */
router.post('/:id/accept-handover', authenticateToken, async (req, res) => {
  const shiftId = parseInt(req.params.id, 10);
  const { closing_cash_actual, item_counts, incoming_cashier_id, notes } = req.body;

  const actualCash = parseFloat(closing_cash_actual);
  if (isNaN(actualCash) || actualCash < 0) {
    return res.status(400).json({ error: 'يرجى إدخال مبلغ النقدية الفعلي المحسوب في الدرج' });
  }

  const client = await db.getClient();
  let inTransaction = false;

  try {
    const shiftRes = await client.query(
      `SELECT id, cashier_id, status, starting_cash FROM shifts WHERE id = $1 FOR UPDATE`,
      [shiftId]
    );

    if (shiftRes.rows.length === 0) {
      return res.status(404).json({ error: 'الوردية المطلوبة غير موجودة' });
    }

    const shift = shiftRes.rows[0];
    if (shift.status !== SHIFT_STATUS.OPEN && shift.status !== SHIFT_STATUS.PENDING_HANDOVER) {
      return res.status(400).json({ error: 'هذه الوردية مغلقة بالفعل مسبقاً' });
    }

    await client.query('BEGIN');
    inTransaction = true;

    const report = await getShiftReport(shiftId, client);

    const expectedCash = report.cash_drawer.closing_cash_expected;
    const cashDiscrepancy = Number((actualCash - expectedCash).toFixed(2));
    const totalSales = report.sales.total_sales;
    const netProfit = report.drawer_split.total_owner_profit;
    const commissionEarned = report.commission.earned;

    let totalShortageDebt = 0.00;
    const targetIncomingId = incoming_cashier_id ? parseInt(incoming_cashier_id, 10) : req.user.id;

    if (Array.isArray(item_counts) && item_counts.length > 0) {
      for (const countItem of item_counts) {
        const itemId = parseInt(countItem.item_id, 10);
        const actualCount = parseFloat(countItem.actual_qty);

        if (isNaN(itemId) || isNaN(actualCount) || actualCount < 0) continue;

        const itemRes = await client.query(
          `SELECT id, name, cost_price, current_stock, track_in_handover FROM items WHERE id = $1 FOR UPDATE`,
          [itemId]
        );

        if (itemRes.rows.length === 0) continue;
        const dbItem = itemRes.rows[0];

        const systemQty = Number(dbItem.current_stock);
        const discrepancyQty = systemQty - actualCount;
        const unitCost = Number(dbItem.cost_price);
        const discrepancyCost = discrepancyQty > 0 ? Number((discrepancyQty * unitCost).toFixed(2)) : 0.00;

        if (discrepancyQty > 0) {
          totalShortageDebt += discrepancyCost;
        }

        await client.query(
          `INSERT INTO handover_items 
            (shift_id, item_id, system_qty, actual_qty, discrepancy_qty, unit_cost, discrepancy_cost)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [shiftId, itemId, systemQty, actualCount, discrepancyQty, unitCost, discrepancyCost]
        );

        await client.query(
          `UPDATE items SET current_stock = $1, updated_at = NOW() WHERE id = $2`,
          [actualCount, itemId]
        );
      }
    }

    // Charge inventory shortage debt to the incoming cashier tab
    if (totalShortageDebt > 0 && targetIncomingId) {
      const userRes = await client.query('SELECT name FROM users WHERE id = $1', [targetIncomingId]);
      const userName = userRes.rows.length > 0 ? userRes.rows[0].name : `شيفتاجي #${targetIncomingId}`;

      const custRes = await client.query(
        `SELECT id, current_debt FROM customers WHERE name ILIKE $1 OR name ILIKE $2 LIMIT 1 FOR UPDATE`,
        [`%${userName}%`, `%شيفتاجي #${targetIncomingId}%`]
      );

      if (custRes.rows.length > 0) {
        const targetCustId = custRes.rows[0].id;
        const newDebt = Number((Number(custRes.rows[0].current_debt) + totalShortageDebt).toFixed(2));
        await client.query(`UPDATE customers SET current_debt = $1, updated_at = NOW() WHERE id = $2`, [newDebt, targetCustId]);
      } else {
        await client.query(
          `INSERT INTO customers (name, current_debt) VALUES ($1, $2)`,
          [userName, totalShortageDebt]
        );
      }
    }

    // STRICTLY CLOSE THE SHIFT (No new shift is inserted)
    await client.query(
      `UPDATE shifts 
       SET status = 'closed',
           end_time = NOW(),
           closing_cash_actual = $1,
           closing_cash_expected = $2,
           cash_discrepancy = $3,
           total_sales = $4,
           net_profit = $5,
           commission_earned = $6,
           incoming_cashier_id = $7,
           notes = COALESCE(notes, '') || ' | ' || $8,
           updated_at = NOW()
       WHERE id = $9`,
      [
        actualCash,
        expectedCash,
        cashDiscrepancy,
        totalSales,
        netProfit,
        commissionEarned,
        targetIncomingId,
        notes || 'تم تسليم الوردية وإغلاقها بنجاح',
        shiftId,
      ]
    );

    await client.query('COMMIT');
    inTransaction = false;

    return res.json({
      message: 'تم إتمام تسليم الوردية وإغلاقها بنجاح. سيتم تسجيل الخروج الآن.',
      closed_shift_id: shiftId,
      financial_reconciliation: {
        closing_cash_actual: actualCash,
        closing_cash_expected: expectedCash,
        cash_discrepancy: cashDiscrepancy,
        total_shortage_debt_charged_to_incoming: totalShortageDebt,
      },
    });
  } catch (err) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rbErr) {}
    }
    console.error('[Handover Error]:', err);
    return res.status(500).json({ error: err.message || 'فشل في إتمام عملية تسليم الوردية' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/shifts/:id/force-close
 * Admin recovery endpoint
 */
router.post('/:id/force-close', authenticateToken, requireOwner, async (req, res) => {
  const shiftId = parseInt(req.params.id, 10);
  const { reason, closing_cash_actual } = req.body;

  if (!reason || reason.trim() === '') {
    return res.status(400).json({ error: 'يجب توضيح سبب الإغلاق الاضطراري' });
  }

  const client = await db.getClient();
  try {
    const report = await getShiftReport(shiftId, client);
    const actualCash = closing_cash_actual !== undefined && closing_cash_actual !== null
      ? parseFloat(closing_cash_actual)
      : report.cash_drawer.closing_cash_expected;

    const discrepancy = Number((actualCash - report.cash_drawer.closing_cash_expected).toFixed(2));

    await client.query(
      `UPDATE shifts 
       SET status = 'force_closed',
           end_time = NOW(),
           closing_cash_actual = $1,
           closing_cash_expected = $2,
           cash_discrepancy = $3,
           force_closed_at = NOW(),
           force_closed_by = $4,
           force_closed_reason = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [
        actualCash,
        report.cash_drawer.closing_cash_expected,
        discrepancy,
        req.user.id,
        reason,
        shiftId,
      ]
    );

    return res.json({ message: 'تم إغلاق الوردية اضطرارياً بنجاح', shift_id: shiftId });
  } catch (err) {
    console.error('[Force Close Shift Error]:', err);
    return res.status(500).json({ error: 'فشل في إغلاق الوردية اضطرارياً' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/shifts/:id/report
 */
router.get('/:id/report', authenticateToken, async (req, res) => {
  try {
    const shiftId = parseInt(req.params.id, 10);
    const report = await getShiftReport(shiftId);
    return res.json(report);
  } catch (err) {
    console.error('[Get Shift Report Error]:', err);
    return res.status(err.status || 500).json({ error: err.message || 'فشل في تحميل تقرير الوردية' });
  }
});

module.exports = router;