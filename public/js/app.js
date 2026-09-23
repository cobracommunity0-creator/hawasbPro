/**
 * Hawasb Cafe POS - Main Application Bootstrap
 */

import { request, showToast } from './api.js';
import { initAuth, authState } from './auth.js';
import { addToCart, cartState } from './cart.js';
import { initCheckout } from './checkout.js';
import { initShiftHandover, fetchCurrentShift } from './shift.js';
import { initReports } from './reports.js';

async function loadItems() {
  try {
    const items = await request('/api/items');
    const grid = document.getElementById('items-grid');
    grid.innerHTML = '';

    items.forEach((item) => {
      const card = document.createElement('div');
      const isNegative = item.current_stock < 0;

      card.className = `p-4 bg-white rounded-xl shadow-sm border ${
        isNegative ? 'border-rose-400 bg-rose-50/20' : 'border-gray-200'
      } hover:shadow-md transition-shadow cursor-pointer flex flex-col justify-between`;

      card.innerHTML = `
        <div>
          <div class="flex items-start justify-between">
            <span class="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">${item.category}</span>
            ${
              isNegative
                ? '<span class="text-xs px-1.5 py-0.5 rounded bg-rose-600 text-white font-bold animate-pulse">رصيد سالب!</span>'
                : `<span class="text-xs text-gray-400">مخزون: ${item.current_stock}</span>`
            }
          </div>
          <h3 class="font-bold text-gray-800 text-base mt-2 leading-tight">${item.name}</h3>
        </div>
        <div class="flex items-center justify-between mt-4">
          <span class="font-extrabold text-emerald-700 text-lg">${Number(item.price).toFixed(2)} <small class="text-xs font-normal">ج.م</small></span>
          <button class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors">
            + إضافة
          </button>
        </div>
      `;

      card.onclick = () => addToCart(item);
      grid.appendChild(card);
    });
  } catch (err) {
    showToast('فشل في تحميل قائمة المبيعات والأصناف', 'error');
  }
}

async function loadCustomers() {
  try {
    const customers = await request('/api/debts');
    const select = document.getElementById('customer-select');
    select.innerHTML = '<option value="">-- اختر العميل من القائمة --</option>';

    customers.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      const creditNote = Number(c.credit_balance) > 0 ? ` (رصيد دائن: ${c.credit_balance} ج.م)` : '';
      const debtNote = Number(c.current_debt) > 0 ? ` [عليه شكك: ${c.current_debt} ج.م]` : '';
      opt.innerText = `${c.name}${c.is_owner ? ' (المالك معفى)' : ''}${creditNote}${debtNote}`;
      select.appendChild(opt);
    });
  } catch (err) {
    showToast('تعذر تحميل بيانات حسابات العملاء', 'error');
  }
}

// Global Force Close Modal setup for Owner (Bug E)
function initForceClose() {
  const forceModal = document.getElementById('force-close-modal');
  const btnOpenForce = document.getElementById('btn-open-force-close');
  const btnConfirmForce = document.getElementById('btn-confirm-force-close');
  const btnCancelForce = document.getElementById('btn-cancel-force-close');

  if (authState.user && authState.user.role === 'owner') {
    btnOpenForce.classList.remove('hidden');
  }

  btnOpenForce.onclick = () => forceModal.classList.remove('hidden');
  btnCancelForce.onclick = () => forceModal.classList.add('hidden');

  btnConfirmForce.onclick = async () => {
    const reason = document.getElementById('force-close-reason').value;
    const cash = document.getElementById('force-close-cash').value;

    if (!reason) {
      showToast('يجب إدخال سبب الإغلاق الاضطراري', 'error');
      return;
    }

    try {
      const shift = await fetchCurrentShift();
      if (!shift) {
        showToast('لا توجد وردية معلقة لإغلاقها!', 'error');
        return;
      }

      await request(`/api/shifts/${shift.id}/force-close`, {
        method: 'POST',
        body: JSON.stringify({ reason, closing_cash_actual: cash ? parseFloat(cash) : null }),
      });

      showToast('تم إغلاق الوردية المعلقة بنجاح', 'success');
      forceModal.classList.add('hidden');
      await fetchCurrentShift();
    } catch (err) {
      console.error('[Force Close Error]:', err);
    }
  };
}

// App Initialization
window.addEventListener('DOMContentLoaded', () => {
  initAuth(async (user) => {
    document.getElementById('logged-user-name').innerText = user.name;
    await fetchCurrentShift();
    await loadItems();
    await loadCustomers();
    initCheckout(() => {
      loadItems();
      loadCustomers();
    });
    initShiftHandover(() => {
      loadItems();
      loadCustomers();
    });
    initReports();
    initForceClose();
  });
});