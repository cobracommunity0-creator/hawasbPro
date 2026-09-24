/**
 * Hawasb Cafe POS - Shift Management & Handover
 * Strict Blind Count & Absolute Anti-Surplus Handover Block
 */

import { request, showToast } from './api.js';
import { authState } from './auth.js';

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
  const user = authState.user;

  if (shift && (shift.status === 'open' || shift.status === 'pending_handover')) {
    const isShiftCashier = user && user.id === shift.cashier_id;
    const isOwner = user && user.role === 'owner';

    if (isShiftCashier) {
      badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-700/50';
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-1.5 animate-pulse"></span>وردية نشطة #${shift.id}`;
      infoText.innerText = `الشيفتاجي: ${shift.cashier_name} | نقدية البداية: ${Number(shift.starting_cash).toFixed(2)} ج.م`;

      if (btnOpenShift) btnOpenShift.classList.add('hidden');
      if (btnOpenHandover) btnOpenHandover.classList.remove('hidden');
    } else if (isOwner) {
      badge.className = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-700/50';
      badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-indigo-400 ml-1.5"></span>وضع المدير • وردية #${shift.id} (${shift.cashier_name})`;
      infoText.innerText = `مراقبة وإدارة النظام • لا يتم تسجيل مبيعات من حساب المدير`;

      if (btnOpenShift) btnOpenShift.classList.add('hidden');
      if (btnOpenHandover) btnOpenHandover.classList.add('hidden');
    }
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

      const countableItems = items.filter((i) => i.track_in_handover);

      // الجرد الأعمى: خانات فارغة تماماً بدون عرض رصيد المنظومة
      countableItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-2.5 border-b border-slate-700/60 text-xs bg-slate-800/40 rounded-xl my-1.5 transition-all';
        row.id = `handover-row-${item.id}`;
        row.innerHTML = `
          <div class="flex items-center space-x-2.5 space-x-reverse flex-1">
            ${
              item.image_url
                ? `<img src="${item.image_url}" class="w-9 h-9 rounded-lg object-cover border border-slate-700 flex-shrink-0">`
                : ''
            }
            <div>
              <span class="font-bold text-slate-100 text-xs block leading-tight">${item.name}</span>
              <span class="text-[10px] text-cyan-400 font-semibold">${item.category}</span>
            </div>
          </div>
          <div class="w-28 text-left">
            <input type="number" step="1" min="0" 
              class="handover-item-input w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-center font-black text-sm text-cyan-300 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
              data-item-id="${item.id}"
              data-item-name="${item.name}"
              data-system-qty="${item.current_stock}"
              placeholder="اكتب العدد"
              value="">
          </div>
        `;
        container.appendChild(row);
      });

      const cashiersSelect = document.getElementById('handover-incoming-cashier');
      if (cashiersSelect) {
        cashiersSelect.innerHTML = '';
        const cashiers = await request('/api/shifts/cashiers');
        cashiers.forEach((c) => {
          if (c.id !== currentShift.cashier_id) {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = `${c.name} (${c.role === 'owner' ? 'المالك' : 'شيفتاجي'})`;
            cashiersSelect.appendChild(opt);
          }
        });
      }

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
      cashInput.focus();
      return;
    }

    const itemInputs = document.querySelectorAll('.handover-item-input');
    const itemCounts = [];
    let hasEmptyField = false;
    let surplusItem = null;

    for (const input of itemInputs) {
      const valStr = input.value.trim();
      const itemId = parseInt(input.dataset.itemId, 10);
      const itemName = input.dataset.itemName;
      const systemQty = parseFloat(input.dataset.systemQty) || 0;

      // منع الحقول الفارغة
      if (valStr === '') {
        input.classList.add('border-rose-500', 'bg-rose-950/40');
        hasEmptyField = true;
      } else {
        input.classList.remove('border-rose-500', 'bg-rose-950/40');
      }

      const actualCount = parseFloat(valStr);

      if (isNaN(actualCount) || actualCount < 0) {
        input.classList.add('border-rose-500');
        hasEmptyField = true;
      }

      // القفل الحديدي: ممنوع نهائياً إدخال أي رقم أكبر من رصيد السيستم
      if (actualCount > systemQty && !surplusItem) {
        surplusItem = {
          name: itemName,
          entered: actualCount,
          system: systemQty,
          element: input,
        };
      }

      itemCounts.push({
        item_id: itemId,
        actual_qty: actualCount || 0,
      });
    }

    if (hasEmptyField) {
      showToast('يرجى إدخال العدد الفعلي لكل صنف (إذا كان الصنف نافداً اكتب 0)', 'error');
      return;
    }

    // إيقاف وحظر التسليم فورياً في حالة وجود أي زيادة
    if (surplusItem) {
      surplusItem.element.classList.add('border-rose-500', 'ring-2', 'ring-rose-500', 'animate-pulse');
      surplusItem.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      surplusItem.element.focus();
      showToast(`ممنوع التسليم بزيادة: صنف (${surplusItem.name}) أدخلت فيه (${surplusItem.entered}) والرصيد المتاح (${surplusItem.system})! أعد العد مع المسلّم بدقة أو تواصل مع المالك.`, 'error');
      return;
    }

    const incomingCashierId = document.getElementById('handover-incoming-cashier')?.value;

    submitHandoverBtn.disabled = true;
    submitHandoverBtn.innerText = 'جاري تسجيل التسليم وتدقيق الجرد...';

    try {
      const payload = {
        closing_cash_actual: actualCash,
        item_counts: itemCounts,
        incoming_cashier_id: incomingCashierId ? parseInt(incomingCashierId, 10) : null,
        notes: document.getElementById('handover-notes')?.value || '',
      };

      const res = await request(`/api/shifts/${currentShift.id}/accept-handover`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showToast(res.message || 'تم تسليم الوردية وإغلاقها بنجاح', 'success');
      handoverModal.classList.add('hidden');
      cashInput.value = '';
      currentShift = null;

      setTimeout(() => {
        localStorage.removeItem('hawasb_token');
        localStorage.removeItem('hawasb_user');
        window.location.reload();
      }, 800);

    } catch (err) {
      console.error('[Handover Submission Error]:', err);
      submitHandoverBtn.disabled = false;
      submitHandoverBtn.innerText = 'تأكيد التسليم وإنهاء الوردية والخروج';
    }
  };
}