/**
 * Hawasb Cafe POS - API Fetch Helper with Unified Toast Alerts (Bug I)
 */

export function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgClass = type === 'success' ? 'bg-emerald-600' : type === 'info' ? 'bg-blue-600' : 'bg-rose-600';

  toast.className = `flex items-center justify-between p-4 mb-3 text-white rounded-lg shadow-lg ${bgClass} transition-all duration-300 transform translate-y-0`;
  toast.innerHTML = `
    <div class="flex items-center space-x-2 space-x-reverse">
      <span class="text-xl">${type === 'success' ? '✓' : '⚠'}</span>
      <span class="font-medium text-sm">${message}</span>
    </div>
    <button class="mr-4 text-white hover:text-gray-200 text-lg leading-none">&times;</button>
  `;

  toast.querySelector('button').onclick = () => toast.remove();
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

export async function request(endpoint, options = {}) {
  const token = localStorage.getItem('hawasb_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const response = await fetch(endpoint, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data.error || `خطأ في الاتصال بالخادم (${response.status})`;
      showToast(errorMsg, 'error');
      const error = new Error(errorMsg);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    if (!err.status) {
      showToast('تعذر الاتصال بالخادم. يرجى التأكد من اتصال الإنترنت.', 'error');
    }
    throw err;
  }
}