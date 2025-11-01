/**
 * Magic Features Page
 * Shows available AI-powered features for QEFY
 */

// DOM elements
let closeBtn, cleanupTabsCard, createPlaylistCard;

// State
let userFolders = [];
let compiledQueue = null;

/**
 * Initialize the magic features page
 */
async function init() {
  console.log('[QEFY Magic] Initializing magic features page');
  
  // Initialize theme mode
  initializeThemeMode();
  
  // Get DOM elements
  closeBtn = document.getElementById('closeBtn');
  cleanupTabsCard = document.getElementById('cleanupTabsCard');
  createPlaylistCard = document.getElementById('createPlaylistCard');
  
  // Load user's queue to get folders
  await loadUserFolders();

  // Initialize i18n
  await initializeI18n();

  // Add event listeners
  closeBtn?.addEventListener('click', () => window.close());
  
  // Add hover effect for cleanup tabs card
  let animationInterval = null;
  let folderInterval = null;
  let sparklesInterval = null;
  
  cleanupTabsCard?.addEventListener('mouseenter', () => {
    startYouTubeIconsAnimation();
    startFolderAnimation();
    startSparklesAnimation();
  });
  
  cleanupTabsCard?.addEventListener('mouseleave', () => {
    stopYouTubeIconsAnimation();
    stopFolderAnimation();
    stopSparklesAnimation();
  });
  
  cleanupTabsCard?.addEventListener('click', async () => {
    const cleanupUrl = chrome.runtime.getURL('cleanup.html');
    
    try {
      // Check if cleanup tab is already open
      const tabs = await chrome.tabs.query({ url: cleanupUrl });
      
      if (tabs.length > 0) {
        // Focus on existing tab
        const existingTab = tabs[0];
        await chrome.tabs.update(existingTab.id, { active: true });
        await chrome.windows.update(existingTab.windowId, { focused: true });
        console.log('[QEFY Magic] Focused on existing cleanup tab');
      } else {
        // Create new tab
        chrome.tabs.create({ url: cleanupUrl });
        console.log('[QEFY Magic] Created new cleanup tab');
      }
    } catch (error) {
      console.error('[QEFY Magic] Error handling cleanup tab:', error);
      // Fallback: create new tab
      chrome.tabs.create({ url: cleanupUrl });
    }
  });

  // Add hover effect for create playlist card
  let typingInterval = null;
  let typingTimeout = null;
  
  createPlaylistCard?.addEventListener('mouseenter', () => {
    startTypingAnimation();
  });
  
  createPlaylistCard?.addEventListener('mouseleave', () => {
    stopTypingAnimation();
  });
  
  createPlaylistCard?.addEventListener('click', async () => {
    const createPlaylistUrl = chrome.runtime.getURL('create_playlist.html');
    
    try {
      // Check if create playlist tab is already open
      const tabs = await chrome.tabs.query({ url: createPlaylistUrl });
      
      if (tabs.length > 0) {
        // Focus on existing tab
        const existingTab = tabs[0];
        await chrome.tabs.update(existingTab.id, { active: true });
        await chrome.windows.update(existingTab.windowId, { focused: true });
        console.log('[QEFY Magic] Focused on existing create playlist tab');
      } else {
        // Create new tab
        chrome.tabs.create({ url: createPlaylistUrl });
        console.log('[QEFY Magic] Created new create playlist tab');
      }
    } catch (error) {
      console.error('[QEFY Magic] Error handling create playlist tab:', error);
      // Fallback: create new tab
      chrome.tabs.create({ url: createPlaylistUrl });
    }
  });
  
  /**
   * Start YouTube icons falling animation
   */
  function startYouTubeIconsAnimation() {
    const container = document.querySelector('#cleanupTabsCard .yt-icons-container');
    if (!container) return;
    
    // Clear any existing animation
    stopYouTubeIconsAnimation();
    
    // Create icons at intervals
    animationInterval = setInterval(() => {
      createFallingIcon(container);
    }, 200); // Create new icon every 200ms
  }
  
  /**
   * Stop YouTube icons animation
   */
  function stopYouTubeIconsAnimation() {
    if (animationInterval) {
      clearInterval(animationInterval);
      animationInterval = null;
    }
    
    // Clear existing icons
    const container = document.querySelector('#cleanupTabsCard .yt-icons-container');
    if (container) {
      container.innerHTML = '';
    }
  }
  
  /**
   * Create a single falling YouTube icon
   */
  function createFallingIcon(container) {
    const icon = document.createElement('img');
    icon.src = 'assets/yticon.png';
    icon.className = 'yt-icon falling';
    
    // Random starting position (horizontal)
    const startX = Math.random() * 100;
    icon.style.left = `${startX}%`;
    
    // Random drift amount (how much it moves horizontally)
    const drift = (Math.random() - 0.5) * 100; // -50px to 50px
    icon.style.setProperty('--drift', `${drift}px`);
    
    // Random rotation
    const rotation = Math.random() * 360;
    icon.style.setProperty('--rotation', `${rotation}deg`);
    
    // Calculate fall distance (to bottom center)
    const containerHeight = container.offsetHeight;
    icon.style.setProperty('--fall-distance', `${containerHeight + 50}px`);
    
    // Random duration (1.5s to 2.5s)
    const duration = 1.5 + Math.random();
    icon.style.setProperty('--duration', `${duration}s`);
    
    container.appendChild(icon);
    
    // Remove icon after animation completes
    setTimeout(() => {
      if (icon.parentNode) {
        icon.remove();
      }
    }, duration * 1000);
  }
  
  /**
   * Start folder generation animation
   */
  function startFolderAnimation() {
    // Use user's folders if they have 4 or more, otherwise use fallback
    const fallbackFolders = ['Podcasts', 'Philosophy', 'Marketing', 'App Development'];
    const folderNames = userFolders.length >= 4 ? userFolders : fallbackFolders;
    let currentIndex = 0;
    
    const folderAnimation = document.querySelector('#cleanupTabsCard .folder-animation');
    const folderNameElement = document.querySelector('#cleanupTabsCard .folder-name');
    
    if (!folderAnimation || !folderNameElement) return;
    
    // Clear any existing animation
    stopFolderAnimation();
    
    // Function to show next folder
    const showNextFolder = () => {
      // Set folder name
      folderNameElement.textContent = folderNames[currentIndex];
      
      // Remove previous animation class
      folderAnimation.classList.remove('show');
      
      // Trigger reflow to restart animation
      void folderAnimation.offsetWidth;
      
      // Add animation class
      folderAnimation.classList.add('show');
      
      // Move to next folder name
      currentIndex = (currentIndex + 1) % folderNames.length;
    };
    
    // Show first folder immediately
    showNextFolder();
    
    // Show new folder every 2 seconds
    folderInterval = setInterval(showNextFolder, 2000);
  }
  
  /**
   * Stop folder generation animation
   */
  function stopFolderAnimation() {
    if (folderInterval) {
      clearInterval(folderInterval);
      folderInterval = null;
    }
    
    const folderAnimation = document.querySelector('#cleanupTabsCard .folder-animation');
    if (folderAnimation) {
      folderAnimation.classList.remove('show');
    }
  }
  
  /**
   * Load user's folders from compiled queue
   */
  async function loadUserFolders() {
    try {
      // Get compiled queue from background script
      const response = await chrome.runtime.sendMessage({ 
        type: 'POPUP_GET_STATE' 
      });
      
      if (response && response.latestCompiledQueue) {
        compiledQueue = response.latestCompiledQueue;
        
        // Extract folder names from foldersOrdering, excluding system folders
        if (compiledQueue.foldersOrdering && Array.isArray(compiledQueue.foldersOrdering)) {
          userFolders = compiledQueue.foldersOrdering.filter(folder => 
            folder && 
            folder !== 'done' && 
            folder !== 'trash' && 
            folder !== 'recently_added'
          );
          
          console.log('[QEFY Magic] Loaded user folders:', userFolders);
        }
      }
    } catch (error) {
      console.warn('[QEFY Magic] Could not load user folders:', error);
      // userFolders will remain empty array, triggering fallback
    }
  }
  
  /**
   * Start sparkles animation
   */
  function startSparklesAnimation() {
    const container = document.querySelector('#cleanupTabsCard .sparkles-container');
    if (!container) return;
    
    // Clear any existing animation
    stopSparklesAnimation();
    
    // Create sparkles at intervals
    sparklesInterval = setInterval(() => {
      createSparkle(container);
    }, 300); // Create new sparkle every 300ms
  }
  
  /**
   * Stop sparkles animation
   */
  function stopSparklesAnimation() {
    if (sparklesInterval) {
      clearInterval(sparklesInterval);
      sparklesInterval = null;
    }
    
    // Clear existing sparkles
    const container = document.querySelector('#cleanupTabsCard .sparkles-container');
    if (container) {
      container.innerHTML = '';
    }
  }
  
  /**
   * Create a single sparkle
   */
  function createSparkle(container) {
    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle flashing';
    sparkle.textContent = '✨';
    
    // Random position
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    sparkle.style.left = `${x}%`;
    sparkle.style.top = `${y}%`;
    
    // Random duration (0.8s to 1.5s)
    const duration = 0.8 + Math.random() * 0.7;
    sparkle.style.setProperty('--sparkle-duration', `${duration}s`);
    
    container.appendChild(sparkle);
    
    // Remove sparkle after animation completes
    setTimeout(() => {
      if (sparkle.parentNode) {
        sparkle.remove();
      }
    }, duration * 1000);
  }
  
  /**
   * Start typing animation
   */
  function startTypingAnimation() {
    const typingTextElement = document.querySelector('#createPlaylistCard .typing-text');
    if (!typingTextElement) return;
    
    // Clear any existing animation
    stopTypingAnimation();
    
    const prompts = [
      'videos about how to make money with apps',
      'videos up to 5 minutes long',
      'create a folder with all my podcasts',
      'all monitor review videos'
    ];
    
    let currentPromptIndex = 0;
    let currentCharIndex = 0;
    let isTyping = true;
    
    const typeNextChar = () => {
      const currentPrompt = prompts[currentPromptIndex];
      
      if (isTyping) {
        // Typing forward
        if (currentCharIndex < currentPrompt.length) {
          typingTextElement.textContent = currentPrompt.substring(0, currentCharIndex + 1);
          currentCharIndex++;
          typingTimeout = setTimeout(typeNextChar, 80); // 80ms per character
        } else {
          // Finished typing, wait before erasing
          typingTimeout = setTimeout(() => {
            isTyping = false;
            typeNextChar();
          }, 2000); // Wait 2 seconds
        }
      } else {
        // Erasing backward
        if (currentCharIndex > 0) {
          currentCharIndex--;
          typingTextElement.textContent = currentPrompt.substring(0, currentCharIndex);
          typingTimeout = setTimeout(typeNextChar, 40); // 40ms per character (faster erase)
        } else {
          // Finished erasing, move to next prompt
          currentPromptIndex = (currentPromptIndex + 1) % prompts.length;
          isTyping = true;
          typingTimeout = setTimeout(typeNextChar, 500); // Wait 500ms before typing next
        }
      }
    };
    
    // Start typing
    typeNextChar();
  }
  
  /**
   * Stop typing animation
   */
  function stopTypingAnimation() {
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
    
    const typingTextElement = document.querySelector('#createPlaylistCard .typing-text');
    if (typingTextElement) {
      typingTextElement.textContent = '';
    }
  }
}

/**
 * Initialize theme mode
 */
function initializeThemeMode() {
  // Load saved theme mode
  chrome.storage.local.get(['themeMode'], (result) => {
    const savedThemeMode = result.themeMode || 'system';
    applyThemeMode(savedThemeMode);
  });
  
  // Listen for theme mode changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.themeMode) {
      applyThemeMode(changes.themeMode.newValue);
    }
  });
}

/**
 * Apply theme mode
 */
function applyThemeMode(mode) {
  const root = document.documentElement;
  root.removeAttribute('data-theme-mode');
  if (mode === 'light' || mode === 'dark') {
    root.setAttribute('data-theme-mode', mode);
  }
}

/**
 * Initialize i18n
 */
async function initializeI18n() {
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
      console.warn('[QEFY Magic] i18n initialization failed:', error);
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

