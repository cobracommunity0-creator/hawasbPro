/**
 * Hawasb Cafe POS - Canonical Shift Financial Report Service
 */

const db = require('../db');
const { DEFAULT_COMMISSION_RATE, DEFAULT_COMMISSION_PAYMENT_METHODS, SETTINGS_KEYS } = require('../config/constants');

async function getShiftReport(shiftId, dbClient = null) {
  const runner = dbClient || db;

  // 1. Fetch Shift Record
  const shiftRes = await runner.query(
    `SELECT s.*, u.name as cashier_name 
     FROM shifts s 
     JOIN users u ON s.cashier_id = u.id 
     WHERE s.id = $1`,
    [shiftId]
  );

  if (shiftRes.rows.length === 0) {
    const error = new Error(`الوردية رقم ${shiftId} غير موجودة`);
    error.status = 404;
    throw error;
  }

  const shift = shiftRes.rows[0];

  // 2. Fetch System Settings
  const settingsRes = await runner.query(
    `SELECT key, value FROM settings WHERE key IN ($1, $2, $3)`,
    [SETTINGS_KEYS.COMMISSION_RATE, SETTINGS_KEYS.COMMISSION_PAYMENT_METHODS, SETTINGS_KEYS.DAILY_FIXED_COST]
  );

  let commissionRate = DEFAULT_COMMISSION_RATE;
  let commissionMethods = DEFAULT_COMMISSION_PAYMENT_METHODS;

  settingsRes.rows.forEach((row) => {
    if (row.key === SETTINGS_KEYS.COMMISSION_RATE) {
      const parsed = parseFloat(row.value);
      if (!isNaN(parsed) && parsed >= 0) commissionRate = parsed;
    } else if (row.key === SETTINGS_KEYS.COMMISSION_PAYMENT_METHODS) {
      commissionMethods = row.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  });

  if (shift.commission_rate !== null && shift.commission_rate !== undefined) {
    commissionRate = Number(shift.commission_rate);
  }

  // 3. Orders Breakdown by Payment Method
  const ordersSummaryRes = await runner.query(
    `SELECT 
        payment_method,
        COUNT(id) as orders_count,
        COALESCE(SUM(subtotal), 0) as total_sales,
        COALESCE(SUM(total_cost), 0) as total_cogs
     FROM orders 
     WHERE shift_id = $1 AND status != 'cancelled'
     GROUP BY payment_method`,
    [shiftId]
  );

  let cashSales = 0.00;
  let vodafoneCashSales = 0.00;
  let creditShakakSales = 0.00;
  let totalOrdersSales = 0.00;
  let totalOrdersCOGS = 0.00;

  ordersSummaryRes.rows.forEach((row) => {
    const method = row.payment_method;
    const sales = Number(row.total_sales);
    const cogs = Number(row.total_cogs);

    totalOrdersSales += sales;
    totalOrdersCOGS += cogs;

    if (method === 'cash') cashSales += sales;
    else if (method === 'vodafone_cash') vodafoneCashSales += sales;
    else if (method === 'credit_shakak') creditShakakSales += sales;
  });

  // 4. Debt Collections during this shift
  const debtCollectionsRes = await runner.query(
    `SELECT 
        payment_method,
        COALESCE(SUM(amount_paid), 0) as total_collected
     FROM debt_payments 
     WHERE shift_id = $1 
     GROUP BY payment_method`,
    [shiftId]
  );

  let cashDebtCollected = 0.00;
  let vodafoneDebtCollected = 0.00;

  debtCollectionsRes.rows.forEach((row) => {
    const amt = Number(row.total_collected);
    if (row.payment_method === 'cash') cashDebtCollected += amt;
    else if (row.payment_method === 'vodafone_cash') vodafoneDebtCollected += amt;
  });

  // 5. Personal Consumptions Breakdown
  const consumptionsRes = await runner.query(
    `SELECT 
        is_owner,
        COALESCE(SUM(quantity * unit_cost), 0) as total_cost,
        COALESCE(SUM(price_charged), 0) as total_charged
     FROM consumptions 
     WHERE shift_id = $1 
     GROUP BY is_owner`,
    [shiftId]
  );

  let staffConsumptionCost = 0.00;
  let staffConsumptionCharged = 0.00;
  let ownerConsumptionCost = 0.00;

  consumptionsRes.rows.forEach((row) => {
    const cost = Number(row.total_cost);
    const charged = Number(row.total_charged);
    if (row.is_owner) {
      ownerConsumptionCost += cost;
    } else {
      staffConsumptionCost += cost;
      staffConsumptionCharged += charged;
    }
  });

  // 6. Expenses from Drawer
  const expensesRes = await runner.query(
    `SELECT COALESCE(SUM(amount), 0) as total_expenses 
     FROM expenses 
     WHERE shift_id = $1`,
    [shiftId]
  );
  const totalExpenses = Number(expensesRes.rows[0].total_expenses);

  // 7. Commission: strictly on cash drawer sales
  let commissionBasisSales = 0.00;
  if (commissionMethods.includes('cash')) commissionBasisSales += cashSales;
  if (commissionMethods.includes('vodafone_cash')) commissionBasisSales += vodafoneCashSales;
  if (commissionMethods.includes('credit_shakak')) commissionBasisSales += creditShakakSales;

  const commissionEarned = Number((commissionBasisSales * commissionRate).toFixed(2));

  const commissionPaidCash = (shift.commission_paid_cash !== null && shift.commission_paid_cash !== undefined)
    ? Number(shift.commission_paid_cash)
    : 0.00;

  const startingCash = (shift.starting_cash !== null && shift.starting_cash !== undefined)
    ? Number(shift.starting_cash)
    : 0.00;

  // 8. Physical Drawer Cash Calculation
  const closingCashExpected = Number(
    (startingCash + cashSales + cashDebtCollected - commissionPaidCash - totalExpenses).toFixed(2)
  );

  const closingCashActual = (shift.closing_cash_actual !== null && shift.closing_cash_actual !== undefined)
    ? Number(shift.closing_cash_actual)
    : null;

  const cashDiscrepancy = closingCashActual !== null
    ? Number((closingCashActual - closingCashExpected).toFixed(2))
    : null;

  // 9. Goods Cost Reserve & Owner Drawer Split
  const restockingCOGSReserve = totalOrdersCOGS;
  const totalDrawerCashInflow = startingCash + cashSales + cashDebtCollected;
  const ownerDrawerNetCash = Number(
    (totalDrawerCashInflow - totalExpenses - commissionEarned - restockingCOGSReserve).toFixed(2)
  );

  const ownerVodafoneProfit = vodafoneCashSales + vodafoneDebtCollected;
  const ownerShakakProfit = creditShakakSales;
  const totalOwnerProfit = Number((ownerDrawerNetCash + ownerVodafoneProfit + ownerShakakProfit).toFixed(2));

  // 10. Items Sold Breakdown
  const itemSalesRes = await runner.query(
    `SELECT 
        i.id as item_id,
        i.name as item_name,
        i.category,
        COALESCE(SUM(oi.quantity), 0) as quantity_sold,
        COALESCE(SUM(oi.total_price), 0) as revenue,
        COALESCE(SUM(oi.total_cost), 0) as cost
     FROM order_items oi
     JOIN orders o ON oi.order_id = o.id
     JOIN items i ON oi.item_id = i.id
     WHERE o.shift_id = $1 AND o.status != 'cancelled'
     GROUP BY i.id, i.name, i.category
     ORDER BY revenue DESC`,
    [shiftId]
  );

  // 11. Handover Shortages (Safe query without joining missing column)
  const handoverItemsRes = await runner.query(
    `SELECT 
        hi.*, i.name as item_name
     FROM handover_items hi
     JOIN items i ON hi.item_id = i.id
     WHERE hi.shift_id = $1
     ORDER BY hi.discrepancy_cost DESC`,
    [shiftId]
  );

  return {
    shift_info: {
      id: shift.id,
      cashier_id: shift.cashier_id,
      cashier_name: shift.cashier_name,
      start_time: shift.start_time,
      end_time: shift.end_time,
      status: shift.status,
      notes: shift.notes,
      incoming_cashier_id: shift.incoming_cashier_id,
    },
    sales: {
      cash_sales: cashSales,
      vodafone_cash_sales: vodafoneCashSales,
      credit_shakak_sales: creditShakakSales,
      total_sales: totalOrdersSales,
      debt_collected_cash: cashDebtCollected,
      debt_collected_vodafone: vodafoneDebtCollected,
    },
    commission: {
      rate: commissionRate,
      rate_percentage: `${(commissionRate * 100).toFixed(0)}%`,
      eligible_cash_sales: commissionBasisSales,
      earned: commissionEarned,
      paid_from_drawer: commissionPaidCash,
    },
    cash_drawer: {
      starting_cash: startingCash,
      cash_sales: cashSales,
      debt_collected: cashDebtCollected,
      commission_payout: commissionPaidCash,
      expenses: totalExpenses,
      closing_cash_expected: closingCashExpected,
      closing_cash_actual: closingCashActual,
      discrepancy: cashDiscrepancy,
    },
    drawer_split: {
      restocking_cogs_reserve: restockingCOGSReserve,
      commission_earned: commissionEarned,
      expenses: totalExpenses,
      owner_drawer_net_cash: ownerDrawerNetCash,
      vodafone_pure_profit: ownerVodafoneProfit,
      shakak_pure_profit: ownerShakakProfit,
      total_owner_profit: totalOwnerProfit,
    },
    items_breakdown: itemSalesRes.rows.map((row) => ({
      item_id: row.item_id,
      item_name: row.item_name,
      category: row.category,
      quantity_sold: Number(row.quantity_sold),
      revenue: Number(row.revenue),
      cost: Number(row.cost),
      profit: Number((Number(row.revenue) - Number(row.cost)).toFixed(2)),
    })),
    handover_shortages: handoverItemsRes.rows.map((row) => ({
      item_id: row.item_id,
      item_name: row.item_name,
      system_qty: Number(row.system_qty),
      actual_qty: Number(row.actual_qty),
      shortage_qty: Number(row.discrepancy_qty),
      unit_cost: Number(row.unit_cost),
      shortage_cost: Number(row.discrepancy_cost),
      charged_cashier: 'الشيفتاجي المستلم',
    })),
  };
}

module.exports = {
  getShiftReport,
};