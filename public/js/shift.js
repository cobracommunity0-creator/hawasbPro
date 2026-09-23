/**
 * Hawasb Cafe POS - Shift Management & Handover
 * Automatic logout upon completing shift handover
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
  const btnOpenShift = document.getElementById('btn-open-shift');
  const btnOpenHandover = document.getElementById('btn-open-handover');

  if (shift && (shift.status === 'open' || shift.status === 'pending_handover')) {
    badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-700/50';
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-1.5 animate-pulse"></span>وردية نشطة #${shift.id}`;
    infoText.innerText = `الشيفتاجي: ${shift.cashier_name || 'أنت'} | البداية: ${Number(shift.starting_cash).toFixed(2)} ج.م`;
    
    if (btnOpenShift) btnOpenShift.classList.add('hidden');
    if (btnOpenHandover) btnOpenHandover.classList.remove('hidden');
  } else {
    badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-950/80 text-rose-400 border border-rose-700/50';
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-500 ml-1.5"></span>لا توجد وردية مفتوحة`;
    infoText.innerText = `يجب فتح وردية لإتمام المبيعات`;

    if (btnOpenShift) btnOpenShift.classList.remove('hidden');
    if (btnOpenHandover) btnOpenHandover.classList.add('hidden');
  }
}

export function initOpenShift(onShiftOpened) {
  const openShiftModal = document.getElementById('open-shift-modal');
  const btnOpenShift = document.getElementById('btn-open-shift');
  const btnCloseOpenShift = document.getElementById('btn-close-open-shift');
  const btnSubmitOpenShift = document.getElementById('btn-submit-open-shift');
  const startingCashInput = document.getElementById('open-shift-starting-cash');
  const notesInput = document.getElementById('open-shift-notes');

  if (!btnOpenShift || !openShiftModal) return;

  btnOpenShift.onclick = () => {
    openShiftModal.classList.remove('hidden');
  };

  btnCloseOpenShift.onclick = () => {
    openShiftModal.classList.add('hidden');
  };

  btnSubmitOpenShift.onclick = async () => {
    const startingCash = parseFloat(startingCashInput.value);

    if (isNaN(startingCash) || startingCash < 0) {
      showToast('يرجى إدخال نقدية بداية الوردية بشكل صحيح', 'error');
      return;
    }

    btnSubmitOpenShift.disabled = true;
    btnSubmitOpenShift.innerText = 'جاري فتح الوردية...';

    try {
      const res = await request('/api/shifts/open', {
        method: 'POST',
        body: JSON.stringify({
          starting_cash: startingCash,
          notes: notesInput.value || '',
        }),
      });

      showToast(res.message || 'تم فتح الوردية بنجاح', 'success');
      openShiftModal.classList.add('hidden');
      startingCashInput.value = '';
      notesInput.value = '';

      await fetchCurrentShift();
      if (onShiftOpened) onShiftOpened(res.shift);
    } catch (err) {
      console.error('[Open Shift Error]:', err);
    } finally {
      btnSubmitOpenShift.disabled = false;
      btnSubmitOpenShift.innerText = 'تأكيد فتح الوردية';
    }
  };
}

export function initShiftHandover(onHandoverComplete) {
  const handoverModal = document.getElementById('handover-modal');
  const openHandoverBtn = document.getElementById('btn-open-handover');
  const submitHandoverBtn = document.getElementById('btn-submit-handover');
  const closeHandoverBtn = document.getElementById('btn-close-handover');

  if (!openHandoverBtn || !handoverModal) return;

  openHandoverBtn.onclick = async () => {
    if (!currentShift) {
      showToast('لا توجد وردية مفتوحة حالياً لتسليمها!', 'error');
      return;
    }

    try {
      const items = await request('/api/items');
      const container = document.getElementById('handover-items-list');
      container.innerHTML = '';

      // Only countable items (track_in_handover == true)
      const countableItems = items.filter((i) => i.track_in_handover);

      countableItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-2 border-b border-slate-700/60 text-xs bg-slate-800/40 rounded my-1';
        row.innerHTML = `
          <div class="flex items-center space-x-2 space-x-reverse flex-1">
            ${
              item.image_url
                ? `<img src="${item.image_url}" class="w-8 h-8 rounded object-cover border border-slate-700">`
                : ''
            }
            <div>
              <span class="font-bold text-slate-200">${item.name}</span>
              <span class="text-[10px] text-slate-400 block">رصيد المنظومة: ${item.current_stock}</span>
            </div>
          </div>
          <div class="w-24">
            <input type="number" step="1" min="0" 
              class="handover-item-input w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded text-center font-bold text-white focus:border-cyan-500"
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

      // Business Rule: Logout cashier upon completing handover
      setTimeout(() => {
        localStorage.removeItem('hawasb_token');
        localStorage.removeItem('hawasb_user');
        window.location.reload();
      }, 1000);

    } catch (err) {
      console.error('[Handover Submission Error]:', err);
      submitHandoverBtn.disabled = false;
      submitHandoverBtn.innerText = 'تأكيد واستلام الوردية';
    }
  };
}