/**
 * Hawasb Cafe POS - Main Application Bootstrap (Midnight Blue Edition)
 */

import { request, showToast } from './api.js';
import { initAuth, authState } from './auth.js';
import { addToCart, renderPCTabs, renderCart } from './cart.js';
import { initCheckout } from './checkout.js';
import { initOpenShift, initShiftHandover, fetchCurrentShift, currentShift } from './shift.js';
import { initReports } from './reports.js';

let allItems = [];
let activeCategory = 'الكل';

const FALLBACK_ITEM_IMG = 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=300&q=80';

async function loadItems() {
  try {
    allItems = await request('/api/items');
    renderCategoryFilter();
    renderFilteredItems();
  } catch (err) {
    showToast('فشل في تحميل قائمة الأصناف', 'error');
  }
}

function renderCategoryFilter() {
  const container = document.getElementById('categories-bar');
  if (!container) return;

  const categories = ['الكل', ...new Set(allItems.map((i) => i.category || 'عام'))];
  container.innerHTML = '';

  categories.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold transition ${
      activeCategory === cat
        ? 'bg-cyan-600 text-white shadow-sm'
        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-750'
    }`;
    btn.innerText = cat;
    btn.onclick = () => {
      activeCategory = cat;
      renderCategoryFilter();
      renderFilteredItems();
    };
    container.appendChild(btn);
  });
}

function renderFilteredItems() {
  const grid = document.getElementById('items-grid');
  grid.innerHTML = '';

  const searchVal = (document.getElementById('item-search')?.value || '').trim().toLowerCase();

  const filtered = allItems.filter((item) => {
    const matchCat = activeCategory === 'الكل' || item.category === activeCategory;
    const matchSearch = !searchVal || item.name.toLowerCase().includes(searchVal);
    return matchCat && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-center py-8 text-slate-500 text-xs">لا توجد أصناف مطابقة للبحث</div>';
    return;
  }

  filtered.forEach((item) => {
    const card = document.createElement('div');
    const isNegative = Number(item.current_stock) < 0;

    card.className = `group p-2 bg-slate-800/90 rounded-xl shadow border ${
      isNegative ? 'border-rose-500/80 bg-rose-950/20' : 'border-slate-700/80'
    } hover:border-cyan-500/80 transition-all cursor-pointer flex flex-col justify-between`;

    const imgUrl = item.image_url || FALLBACK_ITEM_IMG;

    card.innerHTML = `
      <div>
        <div class="relative w-full h-20 rounded-lg overflow-hidden bg-slate-900 border border-slate-750 mb-1.5">
          <img src="${imgUrl}" alt="${item.name}" 
            onerror="this.src='${FALLBACK_ITEM_IMG}'" 
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
          <span class="absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-slate-900/80 backdrop-blur-sm text-cyan-300 font-semibold border border-slate-700">
            ${item.category}
          </span>
          ${
            isNegative
              ? '<span class="absolute bottom-1 left-1 text-[9px] px-1.5 py-0.2 rounded bg-rose-600 text-white font-bold animate-pulse">سالب!</span>'
              : `<span class="absolute bottom-1 left-1 text-[9px] px-1.5 py-0.2 rounded bg-slate-900/80 text-slate-300 font-bold">${item.current_stock}</span>`
          }
        </div>
        <h3 class="font-bold text-slate-100 text-xs truncate leading-snug" title="${item.name}">${item.name}</h3>
      </div>
      <div class="flex items-center justify-between mt-2 pt-1 border-t border-slate-750">
        <span class="font-extrabold text-cyan-400 text-xs">${Number(item.price).toFixed(2)} <small class="text-[9px] font-normal text-slate-400">ج.م</small></span>
        <button class="px-2 py-0.5 bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold rounded-md transition shadow">
          +
        </button>
      </div>
    `;

    card.onclick = () => addToCart(item);
    grid.appendChild(card);
  });
}

async function updateLiveCashierStats() {
  try {
    const res = await request('/api/shifts/current/live-stats');
    if (res.active && res.stats) {
      document.getElementById('stat-drawer-sales').innerText = `${res.stats.cash_sales.toFixed(2)} ج.م`;
      document.getElementById('stat-cashier-commission').innerText = `${res.stats.cashier_commission_earned.toFixed(2)} ج.م`;
      document.getElementById('stat-cogs-reserve').innerText = `${res.stats.restocking_cogs_reserve.toFixed(2)} ج.م`;
    }
  } catch (err) {
    console.warn('[Live Stats Error]:', err);
  }
}

async function loadCustomers(selectedId = null) {
  try {
    const customers = await request('/api/debts');
    const select = document.getElementById('customer-select');
    select.innerHTML = '<option value="">-- اختر العميل لحساب الشكك --</option>';

    customers.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      const creditNote = Number(c.credit_balance) > 0 ? ` (رصيد دائن: ${c.credit_balance} ج.م)` : '';
      const debtNote = Number(c.current_debt) > 0 ? ` [عليه شكك: ${c.current_debt} ج.م]` : '';
      opt.innerText = `${c.name}${c.is_owner ? ' (المالك معفى)' : ''}${creditNote}${debtNote}`;
      if (selectedId && c.id === selectedId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  } catch (err) {
    showToast('تعذر تحميل بيانات حسابات العملاء', 'error');
  }
}

function initCustomerAccounts() {
  const modal = document.getElementById('customers-modal');
  const btnOpen = document.getElementById('btn-open-customers');
  const btnClose = document.getElementById('btn-close-customers');

  btnOpen.onclick = async () => {
    await renderCustomersList();
    modal.classList.remove('hidden');
  };

  btnClose.onclick = () => modal.classList.add('hidden');

  const quickModal = document.getElementById('quick-add-customer-modal');
  const btnOpenQuick = document.getElementById('btn-quick-add-customer');
  const btnCloseQuick = document.getElementById('btn-close-quick-customer');
  const btnSubmitQuick = document.getElementById('btn-submit-quick-customer');

  if (btnOpenQuick) {
    btnOpenQuick.onclick = () => {
      document.getElementById('quick-customer-name').value = '';
      document.getElementById('quick-customer-phone').value = '';
      quickModal.classList.remove('hidden');
    };
  }

  if (btnCloseQuick) {
    btnCloseQuick.onclick = () => quickModal.classList.add('hidden');
  }

  if (btnSubmitQuick) {
    btnSubmitQuick.onclick = async () => {
      const name = document.getElementById('quick-customer-name').value.trim();
      const phone = document.getElementById('quick-customer-phone').value.trim();

      if (!name) {
        showToast('يرجى إدخال اسم العميل', 'error');
        return;
      }

      btnSubmitQuick.disabled = true;
      btnSubmitQuick.innerText = 'جاري الحفظ...';

      try {
        const res = await request('/api/debts/customers', {
          method: 'POST',
          body: JSON.stringify({ name, phone }),
        });

        showToast(res.message || 'تم تسجيل العميل بنجاح', 'success');
        quickModal.classList.add('hidden');
        await loadCustomers(res.customer.id);
      } catch (err) {
        console.error('[Quick Add Customer Error]:', err);
      } finally {
        btnSubmitQuick.disabled = false;
        btnSubmitQuick.innerText = 'إضافة وتحديد العميل';
      }
    };
  }
}

async function renderCustomersList() {
  const container = document.getElementById('customers-list-table-body');
  container.innerHTML = '';

  const customers = await request('/api/debts');

  customers.forEach((c) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-750 hover:bg-slate-800 text-xs';
    tr.innerHTML = `
      <td class="p-2 font-bold text-slate-200">${c.name}</td>
      <td class="p-2 text-slate-400">${c.phone || '-'}</td>
      <td class="p-2 font-bold ${Number(c.current_debt) > 0 ? 'text-rose-400' : 'text-slate-400'}">${Number(c.current_debt).toFixed(2)} ج.م</td>
      <td class="p-2 font-bold text-emerald-400">${Number(c.credit_balance).toFixed(2)} ج.م</td>
      <td class="p-2 text-left space-x-1 space-x-reverse">
        <button class="btn-claim-debt px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[11px] font-bold">
          تحصيل
        </button>
        <button class="btn-view-customer-profile px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-[11px] font-bold">
          كشف الحساب
        </button>
      </td>
    `;

    tr.querySelector('.btn-claim-debt').onclick = () => openClaimDebtModal(c);
    tr.querySelector('.btn-view-customer-profile').onclick = () => openCustomerProfileModal(c.id);

    container.appendChild(tr);
  });
}

function openClaimDebtModal(customer) {
  const modal = document.getElementById('claim-debt-modal');
  document.getElementById('claim-customer-name').innerText = customer.name;
  document.getElementById('claim-current-debt').innerText = `${Number(customer.current_debt).toFixed(2)} ج.م`;
  document.getElementById('claim-amount').value = customer.current_debt;

  modal.classList.remove('hidden');

  document.getElementById('btn-close-claim-debt').onclick = () => modal.classList.add('hidden');

  document.getElementById('btn-submit-claim-debt').onclick = async () => {
    const amount = parseFloat(document.getElementById('claim-amount').value);
    const method = document.getElementById('claim-payment-method').value;
    const notes = document.getElementById('claim-notes').value;

    if (isNaN(amount) || amount <= 0) {
      showToast('يرجى إدخال مبلغ التحصيل بشكل صحيح', 'error');
      return;
    }

    try {
      const res = await request('/api/debts/pay', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customer.id,
          amount,
          payment_method: method,
          notes,
        }),
      });

      showToast(res.message, 'success');
      modal.classList.add('hidden');
      await renderCustomersList();
      await loadCustomers();
      await updateLiveCashierStats();
    } catch (err) {
      console.error('[Claim Debt Error]:', err);
    }
  };
}

async function openCustomerProfileModal(customerId) {
  const modal = document.getElementById('customer-profile-modal');
  modal.classList.remove('hidden');

  document.getElementById('btn-close-customer-profile').onclick = () => modal.classList.add('hidden');

  try {
    const data = await request(`/api/debts/${customerId}/history`);
    document.getElementById('profile-customer-name').innerText = data.customer.name;
    document.getElementById('profile-current-debt').innerText = `${Number(data.customer.current_debt).toFixed(2)} ج.م`;
    document.getElementById('profile-credit-balance').innerText = `${Number(data.customer.credit_balance).toFixed(2)} ج.م`;

    const ordersContainer = document.getElementById('profile-orders-list');
    ordersContainer.innerHTML = '';
    if (data.orders.length === 0) {
      ordersContainer.innerHTML = '<span class="text-xs text-slate-500">لا توجد طلبات سابقة</span>';
    } else {
      data.orders.forEach((o) => {
        const row = document.createElement('div');
        row.className = 'p-2 bg-slate-800/80 rounded-lg border border-slate-700 text-xs mb-1.5';
        const itemsList = o.items.map((it) => `${it.item_name} × ${it.quantity}`).join('، ');
        row.innerHTML = `
          <div class="flex justify-between font-bold text-slate-200">
            <span>طلب #${o.id} (${o.device_tab_name || 'عام'})</span>
            <span class="text-cyan-400">${Number(o.subtotal).toFixed(2)} ج.م</span>
          </div>
          <div class="text-[11px] text-slate-400 mt-1">${itemsList}</div>
          <div class="text-[10px] text-slate-500 mt-0.5">${new Date(o.created_at).toLocaleString('ar-EG')} - ${o.payment_method}</div>
        `;
        ordersContainer.appendChild(row);
      });
    }

    const paymentsContainer = document.getElementById('profile-payments-list');
    paymentsContainer.innerHTML = '';
    if (data.payments.length === 0) {
      paymentsContainer.innerHTML = '<span class="text-xs text-slate-500">لا توجد دفعات سداد مسجلة</span>';
    } else {
      data.payments.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'p-2 bg-emerald-950/40 rounded-lg border border-emerald-800/60 text-xs mb-1.5';
        row.innerHTML = `
          <div class="flex justify-between font-bold text-emerald-300">
            <span>سداد مبلغ: ${Number(p.amount_paid).toFixed(2)} ج.م</span>
            <span class="text-[11px] text-slate-400">${p.payment_method === 'cash' ? 'كاش بالدرج' : 'فودافون كاش'}</span>
          </div>
          <div class="text-[10px] text-emerald-500 mt-0.5">المستلم: ${p.cashier_name} | ${new Date(p.created_at).toLocaleString('ar-EG')}</div>
        `;
        paymentsContainer.appendChild(row);
      });
    }
  } catch (err) {
    showToast('تعذر استخراج بيانات الحساب', 'error');
  }
}

function initAdminItemManagement() {
  const modal = document.getElementById('admin-items-modal');
  const btnOpen = document.getElementById('btn-open-admin-items');
  const btnClose = document.getElementById('btn-close-admin-items');
  const btnSaveItem = document.getElementById('btn-save-item');
  const itemForm = document.getElementById('admin-item-form');

  btnOpen.onclick = async () => {
    await renderAdminItemsTable();
    modal.classList.remove('hidden');
  };

  btnClose.onclick = () => modal.classList.add('hidden');

  btnSaveItem.onclick = async () => {
    const id = document.getElementById('item-form-id').value;
    const name = document.getElementById('item-form-name').value;
    const category = document.getElementById('item-form-category').value;
    const price = parseFloat(document.getElementById('item-form-price').value);
    const cost_price = parseFloat(document.getElementById('item-form-cost').value);
    const current_stock = parseFloat(document.getElementById('item-form-stock').value);
    const image_url = document.getElementById('item-form-image').value;
    const track_in_handover = document.getElementById('item-form-handover').checked;

    if (!name || isNaN(price)) {
      showToast('اسم الصنف وسعر البيع إجباريان', 'error');
      return;
    }

    const payload = { name, category, price, cost_price, current_stock, track_in_handover, image_url };

    try {
      if (id) {
        await request(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('تم تعديل الصنف بنجاح', 'success');
      } else {
        await request('/api/items', { method: 'POST', body: JSON.stringify(payload) });
        showToast('تمت إضافة الصنف بنجاح', 'success');
      }

      itemForm.reset();
      document.getElementById('item-form-id').value = '';
      await renderAdminItemsTable();
      await loadItems();
    } catch (err) {
      console.error('[Save Item Error]:', err);
    }
  };
}

async function renderAdminItemsTable() {
  const container = document.getElementById('admin-items-table-body');
  container.innerHTML = '';
  const items = await request('/api/items');

  items.forEach((item) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-750 hover:bg-slate-800 text-xs';
    tr.innerHTML = `
      <td class="p-2 font-bold text-slate-200 flex items-center space-x-2 space-x-reverse">
        <img src="${item.image_url || FALLBACK_ITEM_IMG}" class="w-7 h-7 rounded object-cover border border-slate-700">
        <span>${item.name}</span>
      </td>
      <td class="p-2 text-slate-400">${item.category}</td>
      <td class="p-2 font-bold text-cyan-400">${Number(item.price).toFixed(2)} ج.م</td>
      <td class="p-2 text-slate-400">${Number(item.cost_price).toFixed(2)} ج.م</td>
      <td class="p-2 font-bold ${Number(item.current_stock) < 0 ? 'text-rose-400' : 'text-slate-300'}">${item.current_stock}</td>
      <td class="p-2 text-slate-400">${item.track_in_handover ? '✓' : '✗'}</td>
      <td class="p-2 text-left space-x-1 space-x-reverse">
        <button class="btn-edit-item px-2 py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-[11px] font-bold">تعديل</button>
        <button class="btn-delete-item px-2 py-1 bg-rose-700 hover:bg-rose-600 text-white rounded text-[11px] font-bold">حذف</button>
      </td>
    `;

    tr.querySelector('.btn-edit-item').onclick = () => {
      document.getElementById('item-form-id').value = item.id;
      document.getElementById('item-form-name').value = item.name;
      document.getElementById('item-form-category').value = item.category;
      document.getElementById('item-form-price').value = item.price;
      document.getElementById('item-form-cost').value = item.cost_price;
      document.getElementById('item-form-stock').value = item.current_stock;
      document.getElementById('item-form-image').value = item.image_url || '';
      document.getElementById('item-form-handover').checked = item.track_in_handover;
    };

    tr.querySelector('.btn-delete-item').onclick = async () => {
      if (!confirm(`هل أنت متأكد من حذف الصنف "${item.name}"؟`)) return;
      try {
        await request(`/api/items/${item.id}`, { method: 'DELETE' });
        showToast('تم حذف الصنف بنجاح', 'success');
        await renderAdminItemsTable();
        await loadItems();
      } catch (err) {
        showToast('تعذر حذف الصنف', 'error');
      }
    };

    container.appendChild(tr);
  });
}

// App Initialization
window.addEventListener('DOMContentLoaded', () => {
  renderPCTabs();
  renderCart();

  initAuth(async (user) => {
    const isOwner = user && user.role === 'owner';
    document.getElementById('logged-user-name').innerText = `${user.name}${isOwner ? ' (مدير)' : ''}`;

    const btnHistory = document.getElementById('btn-open-shifts-history');
    const btnAdminItems = document.getElementById('btn-open-admin-items');

    if (btnHistory) {
      if (isOwner) btnHistory.classList.remove('hidden');
      else btnHistory.classList.add('hidden');
    }

    if (btnAdminItems) {
      if (isOwner) btnAdminItems.classList.remove('hidden');
      else btnAdminItems.classList.add('hidden');
    }

    renderPCTabs();
    renderCart();

    await fetchCurrentShift();
    await loadItems();
    await loadCustomers();
    await updateLiveCashierStats();

    initOpenShift(async () => {
      await loadItems();
      await updateLiveCashierStats();
    });

    initCheckout(async () => {
      await loadItems();
      await loadCustomers();
      await updateLiveCashierStats();
    });

    initShiftHandover(async () => {
      await loadItems();
      await loadCustomers();
      await updateLiveCashierStats();
    });

    initReports();
    initCustomerAccounts();
    initAdminItemManagement();

    document.getElementById('item-search')?.addEventListener('input', renderFilteredItems);
  });
});