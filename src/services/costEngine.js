/**
 * Hawasb Cafe POS - Cost & Inventory Engine
 */

const db = require('../db');
const { SETTINGS_KEYS } = require('../config/constants');

/**
 * Deduct stock for a single item within an active transaction client.
 * Enforces business logic regarding negative inventory in a real café environment.
 */
async function deductSingleItemStock(client, itemId, qty) {
  const quantityToDeduct = Number(qty);
  if (isNaN(quantityToDeduct) || quantityToDeduct <= 0) {
    throw new Error('الكمية المطلوبة للخصم غير صالحة');
  }

  // Row lock on the item
  const itemRes = await client.query(
    `SELECT id, name, cost_price, price, current_stock FROM items WHERE id = $1 FOR UPDATE`,
    [itemId]
  );

  if (itemRes.rows.length === 0) {
    throw new Error(`الصنف رقم ${itemId} غير موجود بالمنظومة`);
  }

  const item = itemRes.rows[0];
  const currentStock = Number(item.current_stock);
  const newStock = currentStock - quantityToDeduct;

  // Read block_negative_stock setting
  const settingRes = await client.query(
    `SELECT value FROM settings WHERE key = $1`,
    [SETTINGS_KEYS.BLOCK_NEGATIVE_STOCK]
  );
  const blockNegative = settingRes.rows.length > 0 && settingRes.rows[0].value.toLowerCase() === 'true';

  if (newStock < 0 && blockNegative) {
    throw new Error(`رصيد الصنف "${item.name}" غير كافٍ لإتمام العملية (الرصيد المتاح: ${currentStock})`);
  }

  // Deduct stock
  await client.query(
    `UPDATE items SET current_stock = $1, updated_at = NOW() WHERE id = $2`,
    [newStock, itemId]
  );

  return {
    itemId: item.id,
    name: item.name,
    unitCost: Number(item.cost_price),
    unitPrice: Number(item.price),
    previousStock: currentStock,
    newStock,
    isNegative: newStock < 0,
  };
}

module.exports = {
  deductSingleItemStock,
};