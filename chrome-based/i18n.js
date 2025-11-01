/**
 * Internationalization (i18n) utility for Chrome Extension
 * Supports English (en), Portuguese Brazil (pt_BR), and Spanish (es)
 */

class I18n {
  constructor() {
    // Default to English - will be overridden by user preference in loadMessages()
    this.currentLocale = 'en';
    this.messages = {};
    // Don't call loadMessages() here - it should be called explicitly after construction
  }

  /**
   * Create and initialize an i18n instance
   * @returns {Promise<I18n>} - Initialized i18n instance
   */
  static async create() {
    const instance = new I18n();
    await instance.loadMessages();
    return instance;
  }

  /**
   * Detect the user's preferred language from browser settings
   * This is DEPRECATED and should not be used.
   * We only use user preference from storage now.
   * @deprecated Use getUserLanguagePreference() instead
   */
  detectLanguage() {
    // Always default to English
    // User must explicitly select their language in settings
    return 'en';
  }

  /**
   * Get user's language preference from storage
   * @returns {Promise<string|null>} - User's preferred locale or null
   */
  async getUserLanguagePreference() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      console.warn('[i18n] Chrome storage API not available');
      return null;
    }

    return new Promise((resolve) => {
      chrome.storage.local.get(['userLanguagePreference'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('[i18n] Error getting language preference:', chrome.runtime.lastError);
          resolve(null);
        } else {
          const preference = result.userLanguagePreference || null;
          console.log('[i18n] Retrieved language preference from storage:', preference);
          resolve(preference);
        }
      });
    });
  }

  /**
   * Set user's language preference in storage
   * @param {string} locale - The locale to set
   * @returns {Promise<boolean>} - Success status
   */
  async setUserLanguagePreference(locale) {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      console.error('[i18n] Chrome storage API not available for setting preference');
      return false;
    }

    const normalizedLocale = this.normalizeLocale(locale);
    console.log('[i18n] Setting language preference to:', normalizedLocale);
    
    return new Promise((resolve) => {
      chrome.storage.local.set({ userLanguagePreference: normalizedLocale }, () => {
        if (chrome.runtime.lastError) {
          console.error('[i18n] ❌ Error setting language preference:', chrome.runtime.lastError);
          resolve(false);
        } else {
          console.log('[i18n] ✅ Language preference saved successfully:', normalizedLocale);
          
          // Verify it was saved
          chrome.storage.local.get(['userLanguagePreference'], (result) => {
            console.log('[i18n] Verification - stored value:', result.userLanguagePreference);
            resolve(true);
          });
        }
      });
    });
  }

  /**
   * Normalize locale code to supported format
   * @param {string} locale - The locale to normalize
   * @returns {string} - Normalized locale code
   */
  normalizeLocale(locale) {
    if (!locale) return 'en';

    // Convert to lowercase and handle different formats
    const normalized = locale.toLowerCase().replace('-', '_');
    
    // Map common variations to our supported locales
    if (normalized.startsWith('pt')) {
      return 'pt_BR'; // Default Portuguese to Brazilian Portuguese
    }
    if (normalized.startsWith('es')) {
      return 'es';
    }
    if (normalized.startsWith('en')) {
      return 'en';
    }

    // Default to English for unsupported languages
    return 'en';
  }

  /**
   * Load messages for the current locale
   * If currentLocale is already set (e.g. after language change), use that instead of storage
   */
  async loadMessages(forceReload = false) {
    try {
      console.log('[i18n] loadMessages called, current locale:', this.currentLocale, 'forceReload:', forceReload);
      
      // If we're force reloading or currentLocale is still default, check storage
      if (forceReload || this.currentLocale === 'en') {
        const userPreference = await this.getUserLanguagePreference();
        
        if (userPreference && this.isLocaleSupported(userPreference)) {
          // User has explicitly set a preference - use it
          this.currentLocale = userPreference;
          console.log('[i18n] Using user language preference from storage:', userPreference);
        } else {
          // No user preference - default to English
          this.currentLocale = 'en';
          console.log('[i18n] No user preference set, defaulting to English');
        }
      } else {
        console.log('[i18n] Using existing locale (not checking storage):', this.currentLocale);
      }

      // Always load from file to support all languages including English
      console.log('[i18n] Loading messages file for locale:', this.currentLocale);
      this.messages = await this.loadFromFile();
      console.log('[i18n] Messages loaded, message count:', Object.keys(this.messages).length);
      
    } catch (error) {
      console.error('[i18n] Error loading messages:', error);
      // Fallback to English
      this.currentLocale = 'en';
      this.messages = await this.loadFromFile();
    }
  }

  /**
   * Load messages using Chrome extension API
   */
  async loadFromChromeAPI() {
    const messages = {};
    const supportedKeys = [
      'appName', 'appDescription', 'appTitle', 'loginTitle', 'addVideoTitle',
      'selectPlaylist', 'addVideo', 'config', 'folder', 'playNow',
      'manageQueue', 'manageQueues', 'manageQueuesTooltip', 'back10s', 'playPause',
      'forward30s', 'markDoneNext', 'notInQueue', 'upNext', 'close',
      'addVideoToFolder', 'selectFolder', 'enterVideoUrl', 'pasteFromClipboard',
      'currentTab', 'saveVideo', 'email', 'password', 'signIn',
      'queueEnded', 'loading', 'error', 'success', 'info',
      'playlistEnded', 'openQefy', 'nowPlaying', 'noMediaNext', 'pleaseSelectAnother', 'playingNow',
      'configTitle', 'specialConfigs', 'autoClassifyVideos', 'aiDescription',
      'aiNotAvailable', 'enableChromeAI', 'learnMore', 'aiDownloading',
      'aiEnabled', 'aiDisabled', 'aiDownloadable'
    ];

    for (const key of supportedKeys) {
      try {
        const message = chrome.i18n.getMessage(key);
        if (message) {
          messages[key] = message;
        }
      } catch (error) {
        // Skip failed keys
      }
    }

    return messages;
  }

  /**
   * Load messages from JSON file
   */
  async loadFromFile() {
    const filePath = `_locales/${this.currentLocale}/messages.json`;
    console.log('[i18n] Attempting to load messages from:', filePath);
    
    try {
      // Use chrome.runtime.getURL for proper extension path
      const fullPath = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL(filePath)
        : filePath;
      
      console.log('[i18n] Full path:', fullPath);
      const response = await fetch(fullPath);
      console.log('[i18n] Fetch response status:', response.status, response.ok);
      
      if (response.ok) {
        const data = await response.json();
        const messages = {};
        for (const [key, value] of Object.entries(data)) {
          messages[key] = value.message;
        }
        console.log('[i18n] ✅ Successfully loaded', Object.keys(messages).length, 'messages from file');
        return messages;
      } else {
        console.warn('[i18n] ⚠️ Response not OK, status:', response.status);
      }
    } catch (error) {
      console.error('[i18n] ❌ Error loading from file:', error);
      // Try fallback to hardcoded messages
      return this.getHardcodedMessages();
    }

    // Fallback to English
    if (this.currentLocale !== 'en') {
      console.warn('[i18n] Falling back to English');
      this.currentLocale = 'en';
      return this.loadFromFile();
    }

    console.warn('[i18n] Using hardcoded messages as final fallback');
    return this.getHardcodedMessages();
  }

  /**
   * Get hardcoded fallback messages when files can't be loaded
   */
  getHardcodedMessages() {
    const messages = {
      en: {
        appName: "QEFY Queue",
        appDescription: "Login, sync user queue to Core App, and show compiled queue.",
        appTitle: "QEFY",
        loginTitle: "QEFY – Login",
        addVideoTitle: "Add Video",
        selectPlaylist: "Select playlist...",
        addVideo: "Add video",
        config: "Config",
        folder: "Folder",
        playNow: "Play now",
        manageQueues: "Manage Queues",
        manageQueuesTooltip: "Manage Queues",
        back10s: "Back 10s",
        playPause: "Play/Pause",
        forward30s: "Forward 30s",
        markDoneNext: "Mark as done and go next",
        notInQueue: "This video is not on your queue",
        upNext: "Up Next",
        close: "Close",
        addVideoToFolder: "Add the video to",
        selectFolder: "Select Folder",
        enterVideoUrl: "Enter video URL...",
        pasteFromClipboard: "Paste from Clipboard",
        currentTab: "Current Tab",
        saveVideo: "Save Video",
        email: "Email",
        password: "Password",
        signIn: "Sign In",
        queueEnded: "Queue ended",
        loading: "Loading...",
        error: "Error",
        success: "Success",
        info: "Info",
        playlistEnded: "Playlist ended - Select new playlist",
        openQefy: "📋 Open Qefy",
        playingNow: "Playing Now",
        configTitle: "Configuration",
        specialConfigs: "Special Configs",
        autoClassifyVideos: "Automatically classify youtube videos",
        aiDescription: "On the right click of a youtube video thumbnail, the extension will automatically classify the video into the appropriate folder",
        aiNotAvailable: "AI features not available",
        enableChromeAI: "You need to enable Google Chrome AI flag",
        learnMore: "Learn more (beta) →",
        aiDownloading: "AI model is downloading... Please wait.",
        aiEnabled: "AI folder suggestions are enabled.",
        aiDisabled: "AI folder suggestions are disabled.",
        aiDownloadable: "AI model is available for download. Enable the toggle to start downloading.",
        aiDeviceIncompatible: "Your device may not meet the requirements or you need to enable Chrome AI flags",
        aiDownloadError: "Error downloading AI model. Please try again.",
        downloadModel: "Download AI Model"
      },
      pt_BR: {
        appName: "QEFY Queue",
        appDescription: "Login, sincronizar fila do usuário com Core App e mostrar fila compilada.",
        appTitle: "QEFY",
        loginTitle: "QEFY – Login",
        addVideoTitle: "Adicionar Vídeo",
        selectPlaylist: "Selecionar playlist...",
        addVideo: "Adicionar vídeo",
        config: "Configurações",
        folder: "Pasta",
        playNow: "Reproduzir agora",
        manageQueues: "Gerenciar Filas",
        manageQueuesTooltip: "Gerenciar Filas",
        back10s: "Voltar 10s",
        playPause: "Reproduzir/Pausar",
        forward30s: "Avançar 30s",
        markDoneNext: "Marcar como concluído e próximo",
        notInQueue: "Este vídeo não está na sua fila",
        upNext: "Próximo",
        close: "Fechar",
        addVideoToFolder: "Adicionar o vídeo para",
        selectFolder: "Selecionar Pasta",
        enterVideoUrl: "Digite a URL do vídeo...",
        pasteFromClipboard: "Colar da Área de Transferência",
        currentTab: "Aba Atual",
        saveVideo: "Salvar Vídeo",
        email: "Email",
        password: "Senha",
        signIn: "Entrar",
        queueEnded: "Fila finalizada",
        loading: "Carregando...",
        error: "Erro",
        success: "Sucesso",
        info: "Informação",
        playlistEnded: "Playlist finalizada - Selecione nova playlist",
        openQefy: "📋 Abrir Qefy",
        playingNow: "Reproduzindo Agora",
        configTitle: "Configurações",
        specialConfigs: "Configurações Especiais",
        autoClassifyVideos: "Classificar automaticamente vídeos do youtube",
        aiDescription: "No clique direito de uma miniatura de vídeo do youtube, a extensão classificará automaticamente o vídeo na pasta apropriada",
        aiNotAvailable: "Recursos de IA não disponíveis",
        enableChromeAI: "Você precisa habilitar a flag de IA do Google Chrome",
        learnMore: "Saiba mais (beta) →",
        aiDownloading: "Modelo de IA está sendo baixado... Aguarde.",
        aiEnabled: "Sugestões de pasta por IA estão habilitadas.",
        aiDisabled: "Sugestões de pasta por IA estão desabilitadas.",
        aiDownloadable: "Modelo de IA está disponível para download. Habilite o toggle para começar o download.",
        aiDeviceIncompatible: "Seu dispositivo pode não atender aos requisitos ou você precisa habilitar as flags de IA do Chrome",
        aiDownloadError: "Erro ao baixar o modelo de IA. Tente novamente.",
        downloadModel: "Baixar Modelo de IA"
      },
      es: {
        appName: "QEFY Queue",
        appDescription: "Iniciar sesión, sincronizar cola de usuario con Core App y mostrar cola compilada.",
        appTitle: "QEFY",
        loginTitle: "QEFY – Iniciar Sesión",
        addVideoTitle: "Agregar Video",
        selectPlaylist: "Seleccionar lista de reproducción...",
        addVideo: "Agregar video",
        config: "Configuración",
        folder: "Carpeta",
        playNow: "Reproducir ahora",
        manageQueues: "Gestionar Colas",
        manageQueuesTooltip: "Gestionar Colas",
        back10s: "Retroceder 10s",
        playPause: "Reproducir/Pausar",
        forward30s: "Avanzar 30s",
        markDoneNext: "Marcar como terminado y siguiente",
        notInQueue: "Este video no está en tu cola",
        upNext: "Siguiente",
        close: "Cerrar",
        addVideoToFolder: "Agregar el video a",
        selectFolder: "Seleccionar Carpeta",
        enterVideoUrl: "Ingresa la URL del video...",
        pasteFromClipboard: "Pegar del Portapapeles",
        currentTab: "Pestaña Actual",
        saveVideo: "Guardar Video",
        email: "Email",
        password: "Contraseña",
        signIn: "Iniciar Sesión",
        queueEnded: "Cola terminada",
        loading: "Cargando...",
        error: "Error",
        success: "Éxito",
        info: "Información",
        playlistEnded: "Lista de reproducción terminada - Selecciona nueva lista",
        openQefy: "📋 Abrir Qefy",
        playingNow: "Reproduciendo Ahora",
        configTitle: "Configuración",
        specialConfigs: "Configuraciones Especiales",
        autoClassifyVideos: "Clasificar automáticamente videos de youtube",
        aiDescription: "En el clic derecho de una miniatura de video de youtube, la extensión clasificará automáticamente el video en la carpeta apropiada",
        aiNotAvailable: "Características de IA no disponibles",
        enableChromeAI: "Necesitas habilitar la bandera de IA de Google Chrome",
        learnMore: "Aprende más (beta) →",
        aiDownloading: "Modelo de IA se está descargando... Por favor espera.",
        aiEnabled: "Sugerencias de carpeta por IA están habilitadas.",
        aiDisabled: "Sugerencias de carpeta por IA están deshabilitadas.",
        aiDownloadable: "Modelo de IA está disponible para descarga. Habilita el toggle para comenzar la descarga.",
        aiDeviceIncompatible: "Su dispositivo puede no cumplir con los requisitos o necesita habilitar las banderas de IA de Chrome",
        aiDownloadError: "Error al descargar el modelo de IA. Intente nuevamente.",
        downloadModel: "Descargar Modelo de IA"
      }
    };

    return messages[this.currentLocale] || messages.en;
  }

  /**
   * Get a translated message
   * @param {string} key - The message key
   * @param {Array} substitutions - Optional substitutions for placeholders
   * @returns {string} - The translated message
   */
  getMessage(key, substitutions = []) {
    let message = this.messages[key] || key;

    // Handle substitutions if provided
    if (substitutions && substitutions.length > 0) {
      substitutions.forEach((sub, index) => {
        message = message.replace(`$${index + 1}`, sub);
      });
    }

    return message;
  }

  /**
   * Get the current locale
   * @returns {string} - The current locale code
   */
  getCurrentLocale() {
    return this.currentLocale;
  }

  /**
   * Check if a locale is supported
   * @param {string} locale - The locale to check
   * @returns {boolean} - True if supported
   */
  isLocaleSupported(locale) {
    const supportedLocales = ['en', 'pt_BR', 'es'];
    return supportedLocales.includes(locale);
  }

  /**
   * Get all supported locales
   * @returns {Array} - Array of supported locale codes
   */
  getSupportedLocales() {
    return ['en', 'pt_BR', 'es'];
  }

  /**
   * Initialize i18n for the current page
   * This should be called after DOM is loaded
   */
  initializePage() {
    // Update all elements with data-i18n attributes
    const elements = document.querySelectorAll('[data-i18n]');
    
    elements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      const message = this.getMessage(key);
      
      if (element.tagName === 'INPUT' && element.type === 'text' || 
          element.tagName === 'INPUT' && element.type === 'email' ||
          element.tagName === 'INPUT' && element.type === 'password' ||
          element.tagName === 'INPUT' && element.type === 'url') {
        element.placeholder = message;
      } else if (element.tagName === 'OPTION') {
        // For option elements, update text content
        element.textContent = message;
      } else if (element.hasAttribute('title')) {
        element.title = message;
      } else {
        element.textContent = message;
      }
    });

    // Update page title if it has data-i18n-title
    const titleElement = document.querySelector('[data-i18n-title]');
    if (titleElement) {
      const titleKey = titleElement.getAttribute('data-i18n-title');
      document.title = this.getMessage(titleKey);
    }

    // Update placeholder attributes
    const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
    placeholderElements.forEach(element => {
      const key = element.getAttribute('data-i18n-placeholder');
      const message = this.getMessage(key);
      if (message) {
        element.placeholder = message;
      }
    });
  }

  /**
   * Update a specific element with i18n content
   * @param {string} selector - CSS selector for the element
   * @param {string} key - The message key
   * @param {Array} substitutions - Optional substitutions
   */
  updateElement(selector, key, substitutions = []) {
    const element = document.querySelector(selector);
    if (element) {
      const message = this.getMessage(key, substitutions);
      
      if (element.tagName === 'INPUT' && (element.type === 'text' || element.type === 'email' || element.type === 'password' || element.type === 'url')) {
        element.placeholder = message;
      } else if (element.hasAttribute('title')) {
        element.title = message;
      } else {
        element.textContent = message;
      }
    }
  }
}

// Create global instance and initialize it
let i18n;

// Initialize i18n when DOM is ready
async function initializeI18n() {
  try {
    i18n = await I18n.create();
    // Make available globally after creation
    if (typeof window !== 'undefined') {
      window.i18n = i18n;
      console.log('[i18n] Global i18n instance created and attached to window');
    }
  } catch (error) {
    console.error('[i18n] Error creating i18n instance:', error);
    // Fallback to basic instance
    i18n = new I18n();
    if (typeof window !== 'undefined') {
      window.i18n = i18n;
    }
  }
}

// Initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeI18n);
  } else {
    initializeI18n();
  }
} else {
  // For non-DOM environments (like service workers)
  initializeI18n();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = I18n;
}
