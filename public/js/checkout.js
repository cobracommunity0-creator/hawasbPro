/**
 * Hawasb Cafe POS - Checkout Flow & Automatic UI Reset
 */

import { request, showToast } from './api.js';
import { getActiveCart, clearActiveCart, cartState } from './cart.js';

export const checkoutState = {
  currentPaymentMethod: 'cash',
  idempotencyKey: null,
};

export function initCheckout(onOrderCompleted) {
  const btnCash = document.getElementById('btn-pay-cash');
  const btnVf = document.getElementById('btn-pay-vf');
  const btnShakak = document.getElementById('btn-pay-shakak');
  const submitBtn = document.getElementById('btn-submit-order');
  const customerSelect = document.getElementById('customer-select');

  function setPaymentMethod(method) {
    checkoutState.currentPaymentMethod = method;

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

  submitBtn.onclick = async () => {
    const cart = getActiveCart();
    if (cart.length === 0) {
      showToast(`سلة (${cartState.activeTab}) فارغة!`, 'error');
      return;
    }

    if (checkoutState.currentPaymentMethod === 'credit_shakak' && !customerSelect.value) {
      showToast('يرجى اختيار العميل لحساب الشكك الآجل', 'error');
      return;
    }

    submitBtn.disabled = true;
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = `<span class="inline-block animate-spin ml-2">⏳</span> جاري حفظ الحساب...`;

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

      showToast(`تم إتمام الحساب لـ (${cartState.activeTab}) بنجاح ✓`, 'success');

      clearActiveCart();
      checkoutState.idempotencyKey = null;

      // Deterministic reset to Cash
      setPaymentMethod('cash');
      customerSelect.value = '';
      cartState.selectedCustomerId = null;

      if (onOrderCompleted) onOrderCompleted(res.order);
    } catch (err) {
      console.error('[Checkout Error]:', err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  };

  setPaymentMethod('cash');
}