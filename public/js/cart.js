/**
 * Hawasb Cafe POS - Multi-Tab Gaming Cafe Cart System (18 PCs + General)
 */

// Generate 18 PCs + General Tab
const defaultTabs = { 'عام': [] };
for (let i = 1; i <= 18; i++) {
  defaultTabs[`جهاز ${i}`] = [];
}

export const cartState = {
  activeTab: 'عام',
  tabs: defaultTabs,
  selectedCustomerId: null,
};

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
  renderPCTabs();
  renderCart();
}

export function clearActiveCart() {
  cartState.tabs[cartState.activeTab] = [];
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
        ? 'bg-emerald-600 text-white shadow-md'
        : count > 0
        ? 'bg-amber-100 text-amber-900 border border-amber-300'
        : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
    }`;

    btn.innerHTML = `
      <span>${name}</span>
      ${
        count > 0
          ? `<span class="mr-1 px-1.5 py-0.2 rounded-full text-[10px] ${               isActive ? 'bg-white text-emerald-800' : 'bg-amber-600 text-white'             }">${count}</span>`
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

  cartItemsContainer.innerHTML = '';
  let subtotal = 0;

  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-10 text-gray-400">
        <span class="text-4xl mb-2">🎮</span>
        <p class="text-xs font-semibold">لا توجد طلبات معلقة لـ (${cartState.activeTab})</p>
      </div>`;
  } else {
    cart.forEach((item) => {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;

      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-2.5 bg-gray-50 rounded-lg border border-gray-100 mb-2';
      row.innerHTML = `
        <div class="flex-1">
          <h4 class="font-bold text-gray-800 text-xs leading-tight">${item.name}</h4>
          <span class="text-[11px] text-gray-500">${item.price.toFixed(2)} × ${item.quantity} = <b>${lineTotal.toFixed(2)} ج.م</b></span>
        </div>
        <div class="flex items-center space-x-1 space-x-reverse">
          <button class="btn-qty-minus w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded font-bold text-gray-700">-</button>
          <span class="w-5 text-center text-xs font-bold">${item.quantity}</span>
          <button class="btn-qty-plus w-6 h-6 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded font-bold text-gray-700">+</button>
        </div>
      `;

      row.querySelector('.btn-qty-minus').onclick = () => updateQty(item.id, -1);
      row.querySelector('.btn-qty-plus').onclick = () => updateQty(item.id, 1);
      cartItemsContainer.appendChild(row);
    });
  }

  subtotalEl.innerText = `${subtotal.toFixed(2)} ج.م`;
}