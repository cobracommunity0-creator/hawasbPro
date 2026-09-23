/**
 * Hawasb Cafe POS - Main Application Bootstrap
 */

import { request, showToast } from './api.js';
import { initAuth, authState } from './auth.js';
import { addToCart, renderPCTabs, renderCart } from './cart.js';
import { initCheckout } from './checkout.js';
import { initOpenShift, initShiftHandover, fetchCurrentShift } from './shift.js';
import { initReports } from './reports.js';

let allItems = [];
let activeCategory = 'الكل';

// 1. Load and Render POS Items with Category Bar
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
    btn.className = `flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
      activeCategory === cat
        ? 'bg-emerald-700 text-white shadow-sm'
        : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
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
    grid.innerHTML = '<div class="col-span-full text-center py-10 text-gray-400 text-xs">لا توجد أصناف تطابق هذا الاختيار</div>';
    return;
  }

  filtered.forEach((item) => {
    const card = document.createElement('div');
    const isNegative = Number(item.current_stock) < 0;

    card.className = `p-3 bg-white rounded-xl shadow-sm border ${
      isNegative ? 'border-rose-400 bg-rose-50/20' : 'border-gray-200'
    } hover:shadow-md transition-shadow cursor-pointer flex flex-col justify-between`;

    card.innerHTML = `
      <div>
        <div class="flex items-start justify-between">
          <span class="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold">${item.category}</span>
          ${
            isNegative
              ? '<span class="text-[10px] px-1 py-0.5 rounded bg-rose-600 text-white font-bold animate-pulse">رصيد سالب!</span>'
              : `<span class="text-[10px] text-gray-400">مخزون: ${item.current_stock}</span>`
          }
        </div>
        <h3 class="font-bold text-gray-800 text-sm mt-2 leading-tight">${item.name}</h3>
      </div>
      <div class="flex items-center justify-between mt-3">
        <span class="font-black text-emerald-700 text-sm">${Number(item.price).toFixed(2)} <small class="text-[10px] font-normal">ج.م</small></span>
        <button class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors">
          + إضافة
        </button>
      </div>
    `;

    card.onclick = () => addToCart(item);
    grid.appendChild(card);
  });
}

// 2. Live Cashier Drawer Stats
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

// 3. Customer Accounts & Shakak Ledger Profiles
async function loadCustomers() {
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
}

async function renderCustomersList() {
  const container = document.getElementById('customers-list-table-body');
  container.innerHTML = '';

  const customers = await request('/api/debts');

  customers.forEach((c) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-gray-100 hover:bg-gray-50 text-xs';
    tr.innerHTML = `
      <td class="p-2 font-bold text-gray-800">${c.name}</td>
      <td class="p-2 text-gray-500">${c.phone || '-'}</td>
      <td class="p-2 font-bold ${Number(c.current_debt) > 0 ? 'text-rose-600' : 'text-gray-500'}">${Number(c.current_debt).toFixed(2)} ج.م</td>
      <td class="p-2 font-bold text-emerald-700">${Number(c.credit_balance).toFixed(2)} ج.م</td>
      <td class="p-2 text-left space-x-1 space-x-reverse">
        <button class="btn-claim-debt px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold">
          تحصيل
        </button>
        <button class="btn-view-customer-profile px-2 py-1 bg-gray-800 hover:bg-gray-900 text-white rounded text-[11px] font-bold">
          كشف الحساب
        </button>
      </td>
    `;

    // Claim debt button
    tr.querySelector('.btn-claim-debt').onclick = () => openClaimDebtModal(c);

    // Profile Ledger button
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

    // Render Orders taken
    const ordersContainer = document.getElementById('profile-orders-list');
    ordersContainer.innerHTML = '';
    if (data.orders.length === 0) {
      ordersContainer.innerHTML = '<span class="text-xs text-gray-400">لا توجد طلبات سابقة</span>';
    } else {
      data.orders.forEach((o) => {
        const row = document.createElement('div');
        row.className = 'p-2 bg-gray-50 rounded-lg border border-gray-100 text-xs mb-1.5';
        const itemsList = o.items.map((it) => `${it.item_name} × ${it.quantity}`).join('، ');
        row.innerHTML = `
          <div class="flex justify-between font-bold text-gray-800">
            <span>طلب #${o.id} (${o.device_tab_name || 'عام'})</span>
            <span class="text-emerald-700">${Number(o.subtotal).toFixed(2)} ج.م</span>
          </div>
          <div class="text-[11px] text-gray-500 mt-1">${itemsList}</div>
          <div class="text-[10px] text-gray-400 mt-0.5">${new Date(o.created_at).toLocaleString('ar-EG')} - ${o.payment_method}</div>
        `;
        ordersContainer.appendChild(row);
      });
    }

    // Render Payments made
    const paymentsContainer = document.getElementById('profile-payments-list');
    paymentsContainer.innerHTML = '';
    if (data.payments.length === 0) {
      paymentsContainer.innerHTML = '<span class="text-xs text-gray-400">لا توجد دفعات سداد مسجلة</span>';
    } else {
      data.payments.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'p-2 bg-emerald-50 rounded-lg border border-emerald-100 text-xs mb-1.5';
        row.innerHTML = `
          <div class="flex justify-between font-bold text-emerald-900">
            <span>سداد مبلغ: ${Number(p.amount_paid).toFixed(2)} ج.م</span>
            <span class="text-[11px] text-gray-600">${p.payment_method === 'cash' ? 'كاش بالدرج' : 'فودافون كاش'}</span>
          </div>
          <div class="text-[10px] text-emerald-800 mt-0.5">استلمه: ${p.cashier_name} | ${new Date(p.created_at).toLocaleString('ar-EG')}</div>
        `;
        paymentsContainer.appendChild(row);
      });
    }
  } catch (err) {
    showToast('تعذر استخراج بيانات الحساب', 'error');
  }
}

// 4. Admin Items Management (Full CRUD)
function initAdminItemManagement() {
  const modal = document.getElementById('admin-items-modal');
  const btnOpen = document.getElementById('btn-open-admin-items');
  const btnClose = document.getElementById('btn-close-admin-items');
  const btnSaveItem = document.getElementById('btn-save-item');
  const itemForm = document.getElementById('admin-item-form');

  if (authState.user && authState.user.role === 'owner') {
    btnOpen.classList.remove('hidden');
  }

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
    const track_in_handover = document.getElementById('item-form-handover').checked;

    if (!name || isNaN(price)) {
      showToast('اسم الصنف وسعر البيع إجباريان', 'error');
      return;
    }

    const payload = { name, category, price, cost_price, current_stock, track_in_handover };

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
    tr.className = 'border-b border-gray-100 hover:bg-gray-50 text-xs';
    tr.innerHTML = `
      <td class="p-2 font-bold text-gray-900">${item.name}</td>
      <td class="p-2 text-gray-600">${item.category}</td>
      <td class="p-2 font-bold text-emerald-700">${Number(item.price).toFixed(2)} ج.م</td>
      <td class="p-2 text-gray-500">${Number(item.cost_price).toFixed(2)} ج.م</td>
      <td class="p-2 font-bold ${Number(item.current_stock) < 0 ? 'text-rose-600' : 'text-gray-800'}">${item.current_stock}</td>
      <td class="p-2 text-left space-x-1 space-x-reverse">
        <button class="btn-edit-item px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-bold">تعديل</button>
        <button class="btn-delete-item px-2 py-1 bg-rose-600 text-white rounded text-[11px] font-bold">حذف</button>
      </td>
    `;

    tr.querySelector('.btn-edit-item').onclick = () => {
      document.getElementById('item-form-id').value = item.id;
      document.getElementById('item-form-name').value = item.name;
      document.getElementById('item-form-category').value = item.category;
      document.getElementById('item-form-price').value = item.price;
      document.getElementById('item-form-cost').value = item.cost_price;
      document.getElementById('item-form-stock').value = item.current_stock;
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
  initAuth(async (user) => {
    document.getElementById('logged-user-name').innerText = user.name;
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

    // Search bar listener
    document.getElementById('item-search')?.addEventListener('input', renderFilteredItems);
  });
});