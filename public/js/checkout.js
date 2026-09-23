/**
 * Hawasb Cafe POS - Checkout Flow
 * Fixes double-submission (Bug B) and deterministic payment method reset (Bug C)
 */

import { request, showToast } from './api.js';
import { getActiveCart, clearActiveCart, cartState } from './cart.js';

export const checkoutState = {
  currentPaymentMethod: 'cash',
  idempotencyKey: null,
};

export function initCheckout(onOrderCompleted) {
  // Bind Payment Method Toggle Buttons (Bug C: Fixed DOM IDs)
  const btnCash = document.getElementById('btn-pay-cash');
  const btnVf = document.getElementById('btn-pay-vf');
  const btnShakak = document.getElementById('btn-pay-shakak');
  const submitBtn = document.getElementById('btn-submit-order');
  const customerSelect = document.getElementById('customer-select');

  function setPaymentMethod(method) {
    checkoutState.currentPaymentMethod = method;

    // Visual button active class highlighting
    btnCash.className = method === 'cash'
      ? 'flex-1 py-2 text-xs font-bold rounded-lg border-2 border-emerald-600 bg-emerald-50 text-emerald-700 shadow-sm'
      : 'flex-1 py-2 text-xs font-bold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50';

    btnVf.className = method === 'vodafone_cash'
      ? 'flex-1 py-2 text-xs font-bold rounded-lg border-2 border-rose-600 bg-rose-50 text-rose-700 shadow-sm'
      : 'flex-1 py-2 text-xs font-bold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50';

    btnShakak.className = method === 'credit_shakak'
      ? 'flex-1 py-2 text-xs font-bold rounded-lg border-2 border-amber-600 bg-amber-50 text-amber-700 shadow-sm'
      : 'flex-1 py-2 text-xs font-bold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50';

    const customerWrapper = document.getElementById('customer-select-wrapper');
    if (method === 'credit_shakak') {
      customerWrapper.classList.remove('hidden');
    } else {
      customerWrapper.classList.add('hidden');
    }
  }

  btnCash.onclick = () => setPaymentMethod('cash');
  btnVf.onclick = () => setPaymentMethod('vodafone_cash');
  btnShakak.onclick = () => setPaymentMethod('credit_shakak');

  // Submit Order Execution (Bug B & C)
  submitBtn.onclick = async () => {
    const cart = getActiveCart();
    if (cart.length === 0) {
      showToast('سلة المشتريات فارغة!', 'error');
      return;
    }

    if (checkoutState.currentPaymentMethod === 'credit_shakak' && !customerSelect.value) {
      showToast('يرجى اختيار العميل لحساب الشكك الآجل', 'error');
      return;
    }

    // Bug B: Disable submit button immediately & show spinner
    submitBtn.disabled = true;
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = `<span class="inline-block animate-spin ml-2">⏳</span> جاري الحفظ...`;

    // Bug B: Generate Idempotency Key ONCE per checkout attempt
    if (!checkoutState.idempotencyKey) {
      checkoutState.idempotencyKey = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    try {
      const payload = {
        cart,
        payment_method: checkoutState.currentPaymentMethod,
        customer_id: customerSelect.value ? parseInt(customerSelect.value, 10) : null,
        idempotency_key: checkoutState.idempotencyKey,
        device_tab_name: cartState.activeTab,
      };

      const res = await request('/api/orders/checkout', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showToast('تم إتمام عملية البيع بنجاح ✓', 'success');

      // Clear cart
      clearActiveCart();

      // Bug B: Reset idempotency key for next transaction
      checkoutState.idempotencyKey = null;

      // Bug C: Deterministically reset state & UI to "cash" and clear customer
      setPaymentMethod('cash');
      customerSelect.value = '';
      cartState.selectedCustomerId = null;

      if (onOrderCompleted) onOrderCompleted(res.order);
    } catch (err) {
      // Keep idempotency key intact on failure so retrying uses the identical key
      console.error('[Checkout Submission Error]:', err);
    } finally {
      // Re-enable button on response settlement
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  };

  // Set initial default to cash
  setPaymentMethod('cash');
}