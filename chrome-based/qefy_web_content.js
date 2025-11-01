// QEFY Web App Content Script
// This script runs on QEFY web app pages to set the extension detection flag

(function() {
  'use strict';

  const EXTENSION_FLAG_KEY = 'flutter.isExtensionEnabled';
  
  // Function to set the extension enabled flag
  function setExtensionEnabled(enabled = true) {
    try {
      localStorage.setItem(EXTENSION_FLAG_KEY, JSON.stringify(enabled));
      console.log('[QEFY Extension] Set flutter.isExtensionEnabled to:', enabled);
      return true;
    } catch (error) {
      console.error('[QEFY Extension] Failed to set extension flag:', error);
      return false;
    }
  }

  // Function to get the current extension flag value
  function getExtensionEnabled() {
    try {
      const value = localStorage.getItem(EXTENSION_FLAG_KEY);
      return value ? JSON.parse(value) : false;
    } catch (error) {
      console.error('[QEFY Extension] Failed to get extension flag:', error);
      return false;
    }
  }

  // Function to check if the extension flag is already set
  function isExtensionFlagSet() {
    return localStorage.getItem(EXTENSION_FLAG_KEY) !== null;
  }

  // Set the extension flag when the script loads
  function initializeExtensionFlag() {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const prefix = isLocalhost ? '[QEFY Extension - Localhost]' : '[QEFY Extension]';
    
    if (!isExtensionFlagSet()) {
      console.log(`${prefix} Initializing extension detection flag`);
      setExtensionEnabled(true);
    } else {
      console.log(`${prefix} Extension flag already set, ensuring it's enabled`);
      setExtensionEnabled(true);
    }
  }

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'QEFY_SET_EXTENSION_FLAG') {
      const success = setExtensionEnabled(message.enabled !== false);
      sendResponse({ success, enabled: getExtensionEnabled() });
      return true; // Keep the message channel open for async response
    }
    
    if (message?.type === 'QEFY_GET_EXTENSION_FLAG') {
      const enabled = getExtensionEnabled();
      sendResponse({ success: true, enabled });
      return true;
    }
  });

  // Initialize when the script loads
  initializeExtensionFlag();

  // Also set the flag when the page becomes visible (in case the app was loaded in background)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      setExtensionEnabled(true);
    }
  });

  // Set the flag periodically to ensure it stays enabled
  setInterval(() => {
    setExtensionEnabled(true);
  }, 30000); // Every 30 seconds

  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const prefix = isLocalhost ? '[QEFY Extension - Localhost]' : '[QEFY Extension]';
  console.log(`${prefix} Web app content script loaded on ${window.location.hostname}:${window.location.port}`);
})();
