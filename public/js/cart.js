/**
 * Hawasb Cafe POS - Multi-Tab Gaming Cafe Cart System (18 PCs + General)
 * With Continuous LocalStorage Persistence
 */

const STORAGE_KEY_TABS = 'hawasb_cafe_pc_tabs_v2';
const STORAGE_KEY_ACTIVE_TAB = 'hawasb_cafe_active_tab_v2';

function initDefaultTabs() {
  const tabs = { 'عام': [] };
  for (let i = 1; i <= 18; i++) {
    tabs[`جهاز ${i}`] = [];
  }
  return tabs;
}

function loadSavedTabs() {
  const defaultTabs = initDefaultTabs();
  try {
    const saved = localStorage.getItem(STORAGE_KEY_TABS);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultTabs, ...parsed };
    }
  } catch (e) {
    console.error('Failed to parse saved tabs from localStorage', e);
  }
  return defaultTabs;
}

export const cartState = {
  activeTab: localStorage.getItem(STORAGE_KEY_ACTIVE_TAB) || 'عام',
  tabs: loadSavedTabs(),
  selectedCustomerId: null,
};

function persistCartState() {
  try {
    localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(cartState.tabs));
    localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, cartState.activeTab);
  } catch (e) {
    console.error('Failed to persist cart state to localStorage', e);
  }
}

export function getActiveCart() {
  if (!cartState.tabs[cartState.activeTab]) {
    cartState.tabs[cartState.activeTab] = [];
  }
  return cartState.tabs[cartState.activeTab];
}

export function getTabCount(tabName) {
  const items = cartState.tabs[tabName] || [];
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function switchTab(tabName) {
  cartState.activeTab = tabName;
  persistCartState();
  renderPCTabs();
  renderCart();
}

export function addToCart(item) {
  const cart = getActiveCart();
  const existing = cart.find((i) => i.id === item.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      cost_price: Number(item.cost_price || 0),
      quantity: 1,
    });
  }
  persistCartState();
  renderPCTabs();
  renderCart();
}

export function updateQty(itemId, delta) {
  const cart = getActiveCart();
  const item = cart.find((i) => i.id === itemId);
  if (!item) return;

  item.quantity += delta;
  if (item.quantity <= 0) {
    const idx = cart.indexOf(item);
    cart.splice(idx, 1);
  }
  persistCartState();
  renderPCTabs();
  renderCart();
}

export function clearActiveCart() {
  cartState.tabs[cartState.activeTab] = [];
  persistCartState();
  renderPCTabs();
  renderCart();
}

export function renderPCTabs() {
  const container = document.getElementById('pc-tabs-bar');
  if (!container) return;

  container.innerHTML = '';
  const tabNames = Object.keys(cartState.tabs);

  tabNames.forEach((name) => {
    const count = getTabCount(name);
    const isActive = cartState.activeTab === name;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center space-x-1 space-x-reverse ${
      isActive
        ? 'bg-cyan-600 text-white shadow-md'
        : count > 0
        ? 'bg-amber-950/80 text-amber-300 border border-amber-700/60'
        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-750'
    }`;

    btn.innerHTML = `
      <span>${name}</span>
      ${
        count > 0
          ? `<span class="mr-1 px-1.5 py-0.2 rounded-full text-[10px] ${               isActive ? 'bg-white text-cyan-900 font-black' : 'bg-amber-500 text-slate-950 font-black'             }">${count}</span>`
          : ''
      }
    `;

    btn.onclick = () => switchTab(name);
    container.appendChild(btn);
  });
}

export function renderCart() {
  const cartItemsContainer = document.getElementById('cart-items');
  const subtotalEl = document.getElementById('cart-subtotal');
  const tabTitle = document.getElementById('active-tab-title');
  const cart = getActiveCart();

  if (tabTitle) tabTitle.innerText = cartState.activeTab;
  if (!cartItemsContainer || !subtotalEl) return;

  cartItemsContainer.innerHTML = '';
  let subtotal = 0;

  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-10 text-slate-500">
        <span class="text-3xl mb-2">🛒</span>
        <p class="text-xs font-semibold">السلة فارغة لـ (${cartState.activeTab})</p>
      </div>`;
  } else {
    cart.forEach((item) => {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;

      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2.5 bg-slate-800/90 rounded-lg border border-slate-700/80 mb-2';
      row.innerHTML = `
        <div class="flex-1">
          <h4 class="font-bold text-slate-100 text-xs leading-tight">${item.name}</h4>
          <span class="text-[11px] text-slate-400">
            ${item.price.toFixed(2)} × ${item.quantity} = <b class="text-cyan-400 font-extrabold">${lineTotal.toFixed(2)} ج.م</b>
          </span>
        </div>
        <div class="flex items-center space-x-1.5 space-x-reverse">
          <button class="btn-qty-minus w-6 h-6 flex items-center justify-center bg-slate-750 hover:bg-slate-700 rounded font-bold text-slate-200 border border-slate-650 transition">-</button>
          <span class="w-6 text-center text-xs font-black text-cyan-300">${item.quantity}</span>
          <button class="btn-qty-plus w-6 h-6 flex items-center justify-center bg-slate-750 hover:bg-slate-700 rounded font-bold text-slate-200 border border-slate-650 transition">+</button>
        </div>
      `;

      row.querySelector('.btn-qty-minus').onclick = () => updateQty(item.id, -1);
      row.querySelector('.btn-qty-plus').onclick = () => updateQty(item.id, 1);
      cartItemsContainer.appendChild(row);
    });
  }

  subtotalEl.innerText = `${subtotal.toFixed(2)} ج.م`;
}