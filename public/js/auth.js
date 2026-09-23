/**
 * Hawasb Cafe POS - Authentication State & PIN Modal
 */

import { request, showToast } from './api.js';

export const authState = {
  user: JSON.parse(localStorage.getItem('hawasb_user') || 'null'),
  token: localStorage.getItem('hawasb_token') || null,
};

export function initAuth(onLoginSuccess) {
  const loginModal = document.getElementById('login-modal');
  const pinDisplay = document.getElementById('pin-display');
  let currentPin = '';

  function updatePinView() {
    pinDisplay.value = '•'.repeat(currentPin.length);
  }

  // Handle PINpad clicks
  document.querySelectorAll('.pin-btn').forEach((btn) => {
    btn.onclick = () => {
      const val = btn.dataset.val;
      if (val === 'C') {
        currentPin = '';
      } else if (val === 'enter') {
        submitLogin();
      } else if (currentPin.length < 6) {
        currentPin += val;
      }
      updatePinView();
    };
  });

  async function submitLogin() {
    if (!currentPin) {
      showToast('يرجى إدخال الرقم السري', 'error');
      return;
    }

    try {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ pin: currentPin }),
      });

      localStorage.setItem('hawasb_token', res.token);
      localStorage.setItem('hawasb_user', JSON.stringify(res.user));
      authState.token = res.token;
      authState.user = res.user;

      currentPin = '';
      updatePinView();
      loginModal.classList.add('hidden');
      showToast(`أهلاً بك، ${res.user.name}`, 'success');

      if (onLoginSuccess) onLoginSuccess(res.user);
    } catch (err) {
      currentPin = '';
      updatePinView();
    }
  }

  document.getElementById('btn-logout').onclick = () => {
    localStorage.removeItem('hawasb_token');
    localStorage.removeItem('hawasb_user');
    authState.user = null;
    authState.token = null;
    window.location.reload();
  };

  if (!authState.token) {
    loginModal.classList.remove('hidden');
  } else {
    loginModal.classList.add('hidden');
    if (onLoginSuccess) onLoginSuccess(authState.user);
  }
}