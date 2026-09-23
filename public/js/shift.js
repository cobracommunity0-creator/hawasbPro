/**
 * Hawasb Cafe POS - Shift Management & Handover
 * Fixes missing closing cash (Bug D) and single active shift constraint (Bug E)
 */

import { request, showToast } from './api.js';

export let currentShift = null;

export async function fetchCurrentShift() {
  try {
    const res = await request('/api/shifts/current');
    currentShift = res.active ? res.shift : null;
    renderShiftBadge(currentShift);
    return currentShift;
  } catch (err) {
    showToast('فشل في جلب بيانات الوردية الحالية', 'error');
    return null;
  }
}

export function renderShiftBadge(shift) {
  const badge = document.getElementById('shift-status-badge');
  const infoText = document.getElementById('shift-info-text');

  if (shift && (shift.status === 'open' || shift.status === 'pending_handover')) {
    badge.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800';
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 ml-1.5 animate-pulse"></span>وردية نشطة #${shift.id}`;
    infoText.innerText = `الشيفتاجي: ${shift.cashier_name || 'أنت'} | البداية: ${shift.starting_cash} ج.م`;
  } else {
    badge.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800';
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 ml-1.5"></span>لا توجد وردية مفتوحة`;
    infoText.innerText = `يجب فتح وردية لإتمام العمليات`;
  }
}

export function initShiftHandover(onHandoverComplete) {
  const handoverModal = document.getElementById('handover-modal');
  const openHandoverBtn = document.getElementById('btn-open-handover');
  const submitHandoverBtn = document.getElementById('btn-submit-handover');
  const closeHandoverBtn = document.getElementById('btn-close-handover');

  openHandoverBtn.onclick = async () => {
    if (!currentShift) {
      showToast('لا توجد وردية مفتوحة حالياً لتسليمها!', 'error');
      return;
    }

    try {
      const items = await request('/api/items');
      const container = document.getElementById('handover-items-list');
      container.innerHTML = '';

      items.filter((i) => i.track_in_handover).forEach((item) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-2 border-b border-gray-100 text-sm';
        row.innerHTML = `
          <div class="flex-1">
            <span class="font-semibold text-gray-800">${item.name}</span>
            <span class="text-xs text-gray-400 block">رصيد المنظومة: ${item.current_stock}</span>
          </div>
          <div class="w-28">
            <input type="number" step="1" min="0" 
              class="handover-item-input w-full px-2 py-1 border border-gray-300 rounded text-center font-bold"
              data-item-id="${item.id}" placeholder="${item.current_stock}" value="${item.current_stock}">
          </div>
        `;
        container.appendChild(row);
      });

      handoverModal.classList.remove('hidden');
    } catch (err) {
      showToast('تعذر تحميل بيانات الجرد اليدوي', 'error');
    }
  };

  closeHandoverBtn.onclick = () => handoverModal.classList.add('hidden');

  submitHandoverBtn.onclick = async () => {
    const cashInput = document.getElementById('handover-actual-cash');
    const actualCash = parseFloat(cashInput.value);

    // Bug D Validation: Do not allow proceeding without counting physical drawer cash
    if (isNaN(actualCash) || actualCash < 0) {
      showToast('يرجى إدخال مبلغ النقدية الفعلي الموجود في الدرج بدقة!', 'error');
      return;
    }

    const itemCounts = [];
    document.querySelectorAll('.handover-item-input').forEach((input) => {
      itemCounts.push({
        item_id: parseInt(input.dataset.itemId, 10),
        actual_qty: parseFloat(input.value) || 0,
      });
    });

    submitHandoverBtn.disabled = true;
    submitHandoverBtn.innerText = 'جاري تسجيل التسليم...';

    try {
      const payload = {
        closing_cash_actual: actualCash,
        item_counts: itemCounts,
        notes: document.getElementById('handover-notes')?.value || '',
      };

      const res = await request(`/api/shifts/${currentShift.id}/accept-handover`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showToast(res.message, 'success');
      handoverModal.classList.add('hidden');
      cashInput.value = '';

      await fetchCurrentShift();
      if (onHandoverComplete) onHandoverComplete();
    } catch (err) {
      console.error('[Handover Submission Error]:', err);
    } finally {
      submitHandoverBtn.disabled = false;
      submitHandoverBtn.innerText = 'تأكيد واستلام الوردية';
    }
  };
}