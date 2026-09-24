/**
 * Hawasb Cafe POS - Checkout Flow & Role Guard
 */

import { request, showToast } from './api.js';
import { getActiveCart, clearActiveCart, cartState } from './cart.js';
import { authState } from './auth.js';
import { currentShift } from './shift.js';

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
  const customerWrapper = document.getElementById('customer-select-wrapper');

  function setPaymentMethod(method) {
    checkoutState.currentPaymentMethod = method;

    btnCash.className = method === 'cash'
      ? 'flex-1 py-1.5 text-xs font-bold rounded-lg border-2 border-emerald-500 bg-emerald-950/60 text-emerald-300 shadow'
      : 'flex-1 py-1.5 text-xs font-bold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-750';

    btnVf.className = method === 'vodafone_cash'
      ? 'flex-1 py-1.5 text-xs font-bold rounded-lg border-2 border-rose-600 bg-rose-950/60 text-rose-300 shadow'
      : 'flex-1 py-1.5 text-xs font-bold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-750';

    btnShakak.className = method === 'credit_shakak'
      ? 'flex-1 py-1.5 text-xs font-bold rounded-lg border-2 border-amber-600 bg-amber-950/60 text-amber-300 shadow'
      : 'flex-1 py-1.5 text-xs font-bold rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-750';

    if (method === 'credit_shakak') {
      customerWrapper.classList.remove('hidden');
    } else {
      customerWrapper.classList.add('hidden');
      // CLEAR customer selection immediately when switching to Cash or VF Cash
      customerSelect.value = '';
      cartState.selectedCustomerId = null;
    }
  }

  btnCash.onclick = () => setPaymentMethod('cash');
  btnVf.onclick = () => setPaymentMethod('vodafone_cash');
  btnShakak.onclick = () => setPaymentMethod('credit_shakak');

  submitBtn.onclick = async () => {
    // Check if user is an Admin monitoring another cashier's shift
    const user = authState.user;
    if (user && user.role === 'owner' && currentShift && currentShift.cashier_id !== user.id) {
      showToast(`أنت في وضع المدير للمراقبة. إتمام البيع مخصص للشيفتاجي المسؤول (${currentShift.cashier_name}) لحماية عهدة الدرج والعمولة.`, 'error');
      return;
    }

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
        // STRICT: ONLY send customer_id if payment is credit_shakak
        customer_id: checkoutState.currentPaymentMethod === 'credit_shakak' && customerSelect.value 
          ? parseInt(customerSelect.value, 10) 
          : null,
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

      // Always reset back to Cash
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