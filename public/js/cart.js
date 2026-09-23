/**
 * Hawasb Cafe POS - Cart State & Device Tabs
 */

export const cartState = {
  activeTab: 'عام',
  tabs: {
    'عام': [],
    'جهاز 1': [],
    'جهاز 2': [],
    'طاولة 1': [],
  },
  selectedCustomerId: null,
};

export function getActiveCart() {
  if (!cartState.tabs[cartState.activeTab]) {
    cartState.tabs[cartState.activeTab] = [];
  }
  return cartState.tabs[cartState.activeTab];
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
  renderCart();
}

export function clearActiveCart() {
  cartState.tabs[cartState.activeTab] = [];
  renderCart();
}

export function renderCart() {
  const cartItemsContainer = document.getElementById('cart-items');
  const subtotalEl = document.getElementById('cart-subtotal');
  const cart = getActiveCart();

  cartItemsContainer.innerHTML = '';
  let subtotal = 0;

  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-10 text-gray-400">
        <span class="text-4xl mb-2">🛒</span>
        <p class="text-sm font-medium">السلة فارغة</p>
      </div>`;
  } else {
    cart.forEach((item) => {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;

      const row = document.createElement('div');
      row.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100 mb-2';
      row.innerHTML = `
        <div class="flex-1">
          <h4 class="font-semibold text-gray-800 text-sm leading-tight">${item.name}</h4>
          <span class="text-xs text-gray-500">${item.price.toFixed(2)} ج.م × ${item.quantity} = <b>${lineTotal.toFixed(2)} ج.م</b></span>
        </div>
        <div class="flex items-center space-x-1 space-x-reverse">
          <button class="btn-qty-minus w-7 h-7 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded font-bold text-gray-700">-</button>
          <span class="w-6 text-center text-sm font-semibold">${item.quantity}</span>
          <button class="btn-qty-plus w-7 h-7 flex items-center justify-center bg-gray-200 hover:bg-gray-300 rounded font-bold text-gray-700">+</button>
        </div>
      `;

      row.querySelector('.btn-qty-minus').onclick = () => updateQty(item.id, -1);
      row.querySelector('.btn-qty-plus').onclick = () => updateQty(item.id, 1);
      cartItemsContainer.appendChild(row);
    });
  }

  subtotalEl.innerText = `${subtotal.toFixed(2)} ج.م`;
}