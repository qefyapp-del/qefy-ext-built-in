import { MessageType } from './messages.js';

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const msg = document.getElementById('msg');

// Initialize i18n system
async function initializeI18n() {
  // Wait for i18n to be available
  let attempts = 0;
  while (typeof i18n === 'undefined' && attempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  
  if (typeof i18n !== 'undefined') {
            try {
              await i18n.loadMessages();
              i18n.initializePage();
            } catch (error) {
              // i18n initialization failed, continue without it
            }
          }
}

// Initialize login
async function initializeLogin() {
  await initializeI18n();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MessageType.AUTH_CREDENTIALS_REQUIRED) {
    const messageText = (typeof i18n !== 'undefined' && i18n.getMessage) ? 
      i18n.getMessage('enterEmailPassword') : 'Enter email and password to sign in.';
    msg.textContent = messageText;
  }
  if (message?.type === MessageType.AUTH_STATE_UPDATE && message?.payload?.status === 'signed_in') {
    // Redirect to the normal popup after successful login
    window.location.href = chrome.runtime.getURL('popup.html');
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = (emailInput.value || '').trim();
  const password = passwordInput.value || '';
  if (!email || !password) {
    const messageText = (typeof i18n !== 'undefined' && i18n.getMessage) ? 
      i18n.getMessage('emailPasswordRequired') : 'Email and password are required.';
    msg.textContent = messageText;
    return;
  }
  chrome.runtime.sendMessage({ type: MessageType.POPUP_SIGN_IN, payload: { email, password } }, () => void chrome.runtime.lastError);
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLogin);
} else {
  initializeLogin();
}


