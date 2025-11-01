// Global listener health checking function
let lastListenerHealthCheck = 0;
const LISTENER_HEALTH_CHECK_COOLDOWN = 10000; // 10 seconds

async function checkAndReconnectListener() {
  const now = Date.now();
  if (now - lastListenerHealthCheck < LISTENER_HEALTH_CHECK_COOLDOWN) {
    return; // Skip if we checked recently
  }
  
  lastListenerHealthCheck = now;
  
  try {
    const health = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CHECK_LISTENER_HEALTH' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ healthy: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { healthy: false, error: 'No response' });
        }
      });
    });
    
    if (!health.healthy) {
      console.log('[QEFY Floating UI] Listener is unhealthy, attempting to reconnect...');
      const reconnectResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'RECONNECT_LISTENER' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { ok: false, error: 'No response' });
          }
        });
      });
      
      if (reconnectResult.ok) {
        console.log('[QEFY Floating UI] Listener reconnected successfully');
        // Trigger a sync to get fresh data
        chrome.runtime.sendMessage({
          type: 'SYNC_PENDING_ACTIONS',
          payload: {}
        });
      } else {
        console.error('[QEFY Floating UI] Failed to reconnect listener:', reconnectResult.error);
      }
    }
  } catch (e) {
    console.error('[QEFY Floating UI] Error checking listener health:', e);
  }
}

(function(){
  try{
    if(document.getElementById('qefy-float-btn')) return;
    if(window.__QEFY_FLOAT_WIRED) return; window.__QEFY_FLOAT_WIRED = true;
    
    // Inject CSS files
    if (!document.getElementById('qefy-material-icons-css')) {
      const materialIconsLink = document.createElement('link');
      materialIconsLink.id = 'qefy-material-icons-css';
      materialIconsLink.rel = 'stylesheet';
      materialIconsLink.href = chrome.runtime.getURL('material-icons.css');
      document.head.appendChild(materialIconsLink);
    }
    
    if (!document.getElementById('qefy-base-css')) {
      const baseLink = document.createElement('link');
      baseLink.id = 'qefy-base-css';
      baseLink.rel = 'stylesheet';
      baseLink.href = chrome.runtime.getURL('base.css');
      document.head.appendChild(baseLink);
    }
    
    // Initialize theme mode from storage
    function applyThemeMode(mode) {
      const root = document.documentElement;
      root.removeAttribute('data-theme-mode');
      if (mode === 'light' || mode === 'dark') {
        root.setAttribute('data-theme-mode', mode);
      }
    }
    
    // Load and apply saved theme mode
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
    
    const btn=document.createElement('div');
    btn.id='qefy-float-btn';
    btn.title='QEFY';
    // Create image element for the icon
    const iconImg = document.createElement('img');
    iconImg.src = chrome.runtime.getURL('icons/combination_mark_square.png');
    iconImg.style.width = '44px';
    iconImg.style.height = '44px';
    iconImg.style.transition = 'transform 0.3s ease';
    iconImg.style.objectFit = 'cover';
    iconImg.style.borderRadius = '50%';
    iconImg.id = 'qefy-icon';
    btn.appendChild(iconImg);
    const panel=document.createElement('div');
    panel.id='qefy-panel';
    panel.innerHTML = `
      <div class="hdr"><div style="font-weight:600" data-i18n="playingNow">Playing Now</div><button class="min" id="qefy-min"><span class="material-symbols-outlined" style="font-size:16px">minimize</span></button></div>
      <div id="qefy-player">
        <div class="mediaRow">
          <img id="mediaThumb" alt="thumb" />
          <div class="titleRow"><div id="mediaTitle">—</div></div>
          <div class="seekRow">
            <input id="seekSlider" type="range" min="0" max="0" value="0" step="0.01" />
            <div id="mediaStatus">--:-- / --:--</div>
          </div>
        </div>
        <div class="controlsRow">
          <div class="controlsLeft">
            <button id="seekBackBtn" data-i18n="back10s" title="Back 10s"><span class="material-symbols-outlined" style="font-size:14px">replay_10</span><span>10</span></button>
            <button id="togglePlayBtn" data-i18n="playPause" title="Play/Pause"><span class="material-symbols-outlined" style="font-size:16px">play_arrow</span></button>
            <button id="seekFwdBtn" data-i18n="forward30s" title="Forward 30s"><span>30</span><span class="material-symbols-outlined" style="font-size:14px">forward_30</span></button>
          </div>
          <div class="controlsRight">
            <select id="speedSelect">
              <option>0.5x</option>
              <option>0.75x</option>
              <option selected>1x</option>
              <option>1.25x</option>
              <option>1.5x</option>
              <option>1.75x</option>
              <option>2x</option>
            </select>
            <button id="markDoneNextBtn" data-i18n="markDoneNext" title="Mark as done and go next"><span class="material-symbols-outlined" style="font-size:14px">skip_next</span><span>Done</span></button>
          </div>
        </div>
         <div class="upnext" id="upNext" style="margin-top:8px;display:none">
           <h3 data-i18n="upNext">Up Next</h3>
           <div class="tile">
             <div id="up1Thumb" class="thumb gray">—</div>
             <div id="up1Title" class="title">—</div>
           </div>
           <div class="tile">
             <div id="up2Thumb" class="thumb gray">—</div>
             <div id="up2Title" class="title">—</div>
           </div>
         </div>
         <div id="playlistEndedMsg" class="warn" style="display:none;margin-top:8px;text-align:center;padding:8px;background:var(--color-tertiary-container, #fff3cd);border:1px solid var(--color-outline, #ffeaa7);border-radius:6px;color:var(--color-on-tertiary-container, #856404);font-size:12px" data-i18n="playlistEnded">Playlist ended - Select new playlist</div>
         <div id="playlistSelector" style="display:none;margin-top:8px">
           <select id="folderSelect" style="width:100%;padding:6px;font-size:12px;border:1px solid var(--color-outline, #ddd);border-radius:4px;margin-bottom:6px;background:var(--color-surface, #fff);color:var(--color-on-surface, #111)">
             <option value="" data-i18n="selectPlaylist">Selecionar playlist...</option>
           </select>
           <button id="playNowBtn" data-i18n="playNow" style="width:100%;padding:8px 12px;font-size:12px;background:var(--color-primary, #904b40);color:var(--color-on-primary, #fff);border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px"><span class="material-symbols-outlined" style="font-size:14px">play_arrow</span><span>Play Now</span></button>
         </div>
         <div style="margin-top:8px;text-align:center">
           <button id="managePlaylistBtn" data-i18n="openQefy" title="Abrir Qefy" style="padding:6px 12px;font-size:12px;background:var(--color-surface-container, #f7f7f7);border:1px solid var(--color-outline, #ddd);border-radius:6px;cursor:pointer;color:var(--color-on-surface, #111);display:inline-flex;align-items:center;gap:4px"><span class="material-symbols-outlined" style="font-size:14px">open_in_new</span><span>Open Qefy</span></button>
         </div>
      </div>`;

    // Persisted position
    const key='qefy_float_pos';
    function loadPos(){
      try{const v=localStorage.getItem(key);if(!v) return;const {x}=JSON.parse(v)||{};if(Number.isFinite(x)) {btn.style.left=x+'px'; btn.style.right='';}}
      catch(_){}
    }
    function savePos(){
      const rect=btn.getBoundingClientRect();
      const x=rect.left+window.scrollX;
      try{localStorage.setItem(key,JSON.stringify({x}));}catch(_){}
    }

    // Drag logic
    let dragging=false, startX=0, startLeft=0;
    function onDown(ev){
      dragging=true; btn.classList.add('dragging');
      const e=ev.touches?ev.touches[0]:ev;
      startX=e.clientX;
      const rect=btn.getBoundingClientRect();
      startLeft=rect.left;
      ev.preventDefault();
    }
    function onMove(ev){
      if(!dragging) return;
      const e=ev.touches?ev.touches[0]:ev;
      const dx=e.clientX-startX;
      const left=Math.max(0,Math.min(window.innerWidth-44,startLeft+dx));
      btn.style.left=left+'px'; btn.style.right='';
      // keep panel centered below button
      const btnRect = btn.getBoundingClientRect();
      const panelWidth = 280; // min-width from CSS
      const panelLeft = Math.max(8, btnRect.left + (btnRect.width - panelWidth) / 2);
      panel.style.left=panelLeft+'px';
    }
    function onUp(){ if(!dragging) return; dragging=false; btn.classList.remove('dragging'); savePos(); }

    btn.addEventListener('mousedown',onDown); document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    btn.addEventListener('touchstart',onDown,{passive:false}); document.addEventListener('touchmove',onMove,{passive:false}); document.addEventListener('touchend',onUp);

    function openPanel(){ 
      // Position panel below button
      const btnRect = btn.getBoundingClientRect();
      const panelWidth = 280; // min-width from CSS
      const panelLeft = Math.max(8, btnRect.left + (btnRect.width - panelWidth) / 2);
      panel.style.left = panelLeft + 'px';
      panel.style.display='block'; 
      requestAnimationFrame(()=>{ panel.classList.add('open'); }); 
      
      // Change icon to base icon with rotation
      const iconImg = document.getElementById('qefy-icon');
      if (iconImg) {
        iconImg.src = chrome.runtime.getURL('icons/base_icon.png');
        iconImg.style.transform = 'rotate(270deg)';
      }
    }
    function closePanel(){ 
      panel.classList.remove('open'); 
      setTimeout(()=>{ panel.style.display='none'; }, 160); 
      
      // Change icon back to combination mark
      const iconImg = document.getElementById('qefy-icon');
      if (iconImg) {
        iconImg.src = chrome.runtime.getURL('icons/combination_mark_square.png');
        iconImg.style.transform = 'rotate(0deg)';
      }
    }
    const minBtn = panel.querySelector('#qefy-min');
    minBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); closePanel(); });
    btn.addEventListener('click',()=>{ 
      if(dragging) return; 
      if(panel.style.display==='none'||!panel.style.display){ 
        openPanel(); 
        // Trigger sync when floating panel opens (now with cooldown protection)
        chrome.runtime.sendMessage({
          type: 'SYNC_PENDING_ACTIONS',
          payload: {}
        }, (response) => {
          if (response && response.ok) {
          } else {
            console.error('[QEFY] Failed to trigger floating panel sync:', response?.error);
          }
        });
      } else { 
        closePanel(); 
      } 
    });

    document.body.appendChild(btn);document.body.appendChild(panel);
    loadPos();
  }catch(e){/*noop*/}
})();

// Media progress wiring
(function(){
  try{
    let lastSent = 0;
    let lastProgressUpdate = 0;
    const PROGRESS_UPDATE_INTERVAL = 5000; // 5 seconds
    function pick(){ return document.querySelector('video, audio'); }
    function fmt(t){ if(!Number.isFinite(t)||t<=0) return '--:--'; const m=Math.floor(t/60); const s=Math.floor(t%60); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
    function parseRate(value){ if(typeof value==='string' && value.endsWith('x')) return Number(value.slice(0,-1))||1; const n=Number(value); return Number.isFinite(n)?n:1; }
    function setQefyTitle() {
      try {
        const cur = document.title || '';
        const base = cur.replace(/^\[QEFY\]\s*/i, '');
        document.title = `[QEFY] ${base}`;
      } catch(_) {}
    }
    let latestQueue = null;

    // Function to move current video to done folder and navigate to next
    window.moveCurrentVideoToDoneAndNavigateNext = async function() {
      try {
        // Prevent multiple calls
        if (window.videoMoveInProgress) {
          return;
        }
        window.videoMoveInProgress = true;

        // Check listener health before important actions
        await checkAndReconnectListener();

        // Get current video URL
        const currentUrl = location.href;
        
        // Find the current video in the queue to get its UUID and current folder
        const currentItem = findItemByUrlInQueue(currentUrl);
        if (!currentItem || !currentItem.item) {
          // Check if video is already in done folder (playlist ended)
          const foundIncludingDone = findItemByUrlInQueueIncludingDone(currentUrl);
          if (foundIncludingDone && foundIncludingDone.folder === 'done') {
            window.videoMoveInProgress = false;
            return;
          }
          console.warn('[QEFY] Current video not found in queue');
          window.videoMoveInProgress = false;
          return;
        }

        // Create MV action to move video to done folder
        const moveAction = {
          type: 'mv',
          uuid: currentItem.item.uuid,
          path: currentItem.folder,
          targetPath: 'done',
          targetIndex: 0  // Add to top of done folder
        };

        // Send action to core app via background script
        chrome.runtime.sendMessage({
          type: 'SEND_ACTION_TO_CORE',
          payload: { actionJson: JSON.stringify(moveAction) }
        }, (response) => {
          if (response && response.ok) {
            
            // Trigger sync after sending action (now with cooldown protection)
            chrome.runtime.sendMessage({
              type: 'SYNC_PENDING_ACTIONS',
              payload: {}
            }, (syncResponse) => {
              if (syncResponse && syncResponse.ok) {
              } else {
                console.error('[QEFY] Failed to trigger sync:', syncResponse?.error);
              }
            });

            // Get next video from upnext and navigate
            const upNext = document.getElementById('upNext');
            if (upNext) {
              const firstTile = upNext.querySelector('.tile:first-of-type');
              if (firstTile) {
                const nextUrl = firstTile.getAttribute('data-url');
                if (nextUrl) {
                  // Navigate to next video using background script to maintain hijacked state
                  chrome.runtime.sendMessage({
                    type: 'POPUP_PLAY_NOW',
                    payload: { url: nextUrl }
                  }, (response) => {
                    if (response && response.ok) {
                    } else {
                      console.error('[QEFY] Failed to navigate to next video:', response?.error);
                    }
                  });
                } else {
                  console.warn('[QEFY] No URL found in first upnext tile');
                }
              } else {
                console.warn('[QEFY] No first tile found in upnext section');
              }
            } else {
              console.warn('[QEFY] Upnext section not found');
            }
          } else {
            console.error('[QEFY] Failed to move video to done folder:', response?.error);
          }
        });
      } catch (err) {
        console.error('[QEFY] Error in moveCurrentVideoToDoneAndNavigateNext:', err);
      }
    };
    chrome.runtime?.onMessage.addListener((msg, sender, sendResponse)=>{
      if(msg && msg.type === 'COMPILED_QUEUE_UPDATE') {
        latestQueue = msg.payload || null;
        // Update folder selector if playlist selector is visible and user is not interacting
        const playlistSelector = document.getElementById('playlistSelector');
        const folderSelect = document.getElementById('folderSelect');
        if (playlistSelector && playlistSelector.style.display !== 'none' && 
            (!folderSelect || folderSelect.dataset.userInteracting !== 'true')) {
          populateFolderSelector();
        }
        const v = pick(); if(v) render(v);
        // Send response back to background script
        if (sendResponse) sendResponse({ received: true });
      } else if(msg && msg.type === 'QEFY_MEDIA_PROGRESS') {
        // Update upnext when media progress changes (e.g., when navigating to different video)
        const v = pick(); if(v) render(v);
      }
    });
    // Request current queue state on load
    chrome.runtime?.sendMessage({ type: 'POPUP_GET_STATE' }, (state) => {
      if(state && state.latestCompiledQueue) {
        latestQueue = state.latestCompiledQueue;
        const v = pick(); if(v) render(v);
      }
    });
    function canonicalYouTubeId(u) {
      try {
        const url = new URL(u);
        if (url.hostname.includes('youtube.com')) {
          if (url.pathname === '/watch') return url.searchParams.get('v');
          const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{5,})/);
          if (shorts) return shorts[1];
          const embed = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{5,})/);
          if (embed) return embed[1];
        }
        if (url.hostname === 'youtu.be') {
          const seg = url.pathname.split('/').filter(Boolean)[0];
          if (seg) return seg;
        }
      } catch (_) {}
      return null;
    }

    function findItemByUrlInQueue(url) {
      if (!latestQueue) return null;
      const q = latestQueue.queue || {};
      const targetId = canonicalYouTubeId(url);
      for (const folder of Object.keys(q)) {
        // Ignore done and trash folders
        if (folder === 'done' || folder === 'trash') continue;
        
        const list = q[folder] || [];
        for (const it of list) {
          if (!it || !it.url) continue;
          if (it.url === url) return { item: it, folder };
          if (targetId) {
            const itId = canonicalYouTubeId(it.url);
            if (itId && itId === targetId) return { item: it, folder };
          }
        }
      }
      return null;
    }

    function findItemByUrlInQueueIncludingDone(url) {
      if (!latestQueue) return null;
      const q = latestQueue.queue || {};
      const targetId = canonicalYouTubeId(url);
      for (const folder of Object.keys(q)) {
        // Include done folder to check if video was moved there
        if (folder === 'trash') continue;
        
        const list = q[folder] || [];
        for (const it of list) {
          if (!it || !it.url) continue;
          if (it.url === url) return { item: it, folder };
          if (targetId) {
            const itId = canonicalYouTubeId(it.url);
            if (itId && itId === targetId) return { item: it, folder };
          }
        }
      }
      return null;
    }

    function populateFolderSelector() {
      const folderSelect = document.getElementById('folderSelect');
      if (!folderSelect || !latestQueue) return;
      
      // Don't repopulate if user is currently interacting with the dropdown
      if (folderSelect.matches(':focus') || folderSelect.dataset.userInteracting === 'true') {
        return;
      }
      
      // Clear existing options except the first one
      folderSelect.innerHTML = `<option value="">${typeof i18n !== 'undefined' ? i18n.getMessage('selectPlaylist') : 'Selecionar playlist...'}</option>`;
      
      const q = latestQueue.queue || {};
      const folders = Object.keys(q).filter(folder => 
        folder !== 'done' && folder !== 'trash' && 
        Array.isArray(q[folder]) && q[folder].length > 0
      );
      
      folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder;
        option.textContent = folder;
        folderSelect.appendChild(option);
      });
    }

    function computeAndRenderUpNext(currentUrl) {
      try {
        const upNext = document.getElementById('upNext');
        if (!latestQueue || !upNext) return;
        const found = currentUrl ? findItemByUrlInQueue(currentUrl) : null;
        let next1 = null, next2 = null;
        if (found && found.item) {
          const q = latestQueue.queue || {};
          const list = Array.isArray(q[found.folder]) ? q[found.folder] : [];
          const idx = list.findIndex(it => {
            if (!it) return false;
            if (found.item.uuid && it.uuid) return it.uuid === found.item.uuid;
            if (it.url === found.item.url) return true;
            const a = canonicalYouTubeId(it.url);
            const b = canonicalYouTubeId(found.item.url);
            return !!a && a === b;
          });
          if (idx >= 0) {
            next1 = list[idx + 1] || null;
            next2 = list[idx + 2] || null;
          }
        }
        const setTile = (tileThumb, tileTitle, item) => {
          if (!tileThumb || !tileTitle) return;
          
          // Get the parent tile element to set data-url
          const tileElement = tileThumb.closest('.tile');
          
          if (!item) {
            tileThumb.classList.add('gray');
            tileThumb.style.backgroundImage = '';
            tileTitle.textContent = typeof i18n !== 'undefined' ? i18n.getMessage('noMediaNext') : 'No media next';
            if (tileElement) tileElement.removeAttribute('data-url');
            return;
          }
          
          // Set the data-url attribute on the tile element
          if (tileElement) {
            tileElement.setAttribute('data-url', item.url || '');
          }
          
          const th = item?.metadata?.thumb || '';
          if (th) {
            tileThumb.classList.remove('gray');
            tileThumb.style.backgroundImage = `url(${th})`;
            tileThumb.style.backgroundSize = 'cover';
            tileThumb.style.backgroundPosition = 'center';
          } else {
            tileThumb.classList.add('gray');
            tileThumb.style.backgroundImage = '';
          }
          tileTitle.textContent = item?.metadata?.title || item?.url || '—';
        };
        
        // Check if we're at the end of the current folder
        const isAtEndOfFolder = found && found.item && found.folder && 
          latestQueue.queue && latestQueue.queue[found.folder] && 
          Array.isArray(latestQueue.queue[found.folder]);
        
        if (next1 || next2) {
          upNext.style.display = 'block';
          setTile(document.getElementById('up1Thumb'), document.getElementById('up1Title'), next1);
          setTile(document.getElementById('up2Thumb'), document.getElementById('up2Title'), next2);
        } else if (isAtEndOfFolder) {
          // Show queue ended message when at the end of current folder
          upNext.style.display = 'block';
          const up1Thumb = document.getElementById('up1Thumb');
          const up1Title = document.getElementById('up1Title');
          const up2Thumb = document.getElementById('up2Thumb');
          const up2Title = document.getElementById('up2Title');
          
          if (up1Thumb && up1Title) {
            up1Thumb.classList.add('gray');
            up1Thumb.style.backgroundImage = '';
            up1Title.textContent = typeof i18n !== 'undefined' ? i18n.getMessage('queueEnded') : 'Queue ended';
            up1Title.className = 'title queue-ended-message';
          }
          
          if (up2Thumb && up2Title) {
            up2Thumb.classList.add('gray');
            up2Thumb.style.backgroundImage = '';
            up2Title.textContent = typeof i18n !== 'undefined' ? i18n.getMessage('pleaseSelectAnother') : 'Please select another';
            up2Title.className = 'title queue-ended-message';
          }
        } else {
          upNext.style.display = 'none';
        }
      } catch (_) {
        try { 
          const upNext = document.getElementById('upNext');
          if (upNext) upNext.style.display = 'none'; 
        } catch (_) {}
      }
    }
    function setThumb(el, url){ if(!el) return; if(url){ if(el.tagName==='IMG'){ el.src=url; } else { el.style.backgroundImage=`url(${url})`; el.style.backgroundSize='cover'; el.style.backgroundPosition='center'; } } }
    function render(v){
      try{
        const titleEl = document.getElementById('mediaTitle');
        const thumbEl = document.getElementById('mediaThumb');
        const statusEl = document.getElementById('mediaStatus');
        const slider = document.getElementById('seekSlider');
        if(!titleEl||!thumbEl||!statusEl||!slider) return;

        let title = document.title || '';
        let thumb = '';
        try{
          const md = navigator?.mediaSession?.metadata;
          if(md){
            title = md.title || title;
            const art = Array.isArray(md.artwork)?md.artwork:[];
            const first = art.find(a=>a&&a.src);
            if(first) thumb = first.src;
          }
        }catch(_){ }
        titleEl.textContent = title || '—';
        if(thumb) { thumbEl.src = thumb; }

        const dur = Number.isFinite(v.duration)?v.duration:0;
        const cur = Number(v.currentTime||0);
        slider.max = String(dur||0);
        slider.value = String(Math.min(dur, cur));
        statusEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;

        // Auto-open floating panel when less than 10 seconds remaining
        if (dur > 0 && cur > 0 && !v.paused) {
          const timeRemaining = dur - cur;
          if (timeRemaining <= 10 && timeRemaining > 0 && !window.autoShowTriggered) {
            window.autoShowTriggered = true;
            try {
              // Open panel when near end of media
              const panelEl = document.getElementById('qefy-panel');
              const btnEl = document.getElementById('qefy-float-btn');
              
              if (panelEl && btnEl) {
                const btnRect = btnEl.getBoundingClientRect();
                const panelWidth = 280;
                const panelLeft = Math.max(8, btnRect.left + (btnRect.width - panelWidth) / 2);
                panelEl.style.left = panelLeft + 'px';
                panelEl.style.display = 'block'; 
                requestAnimationFrame(() => { panelEl.classList.add('open'); }); 
                
                // Trigger sync when auto-opening floating panel (now with cooldown protection)
                chrome.runtime.sendMessage({
                  type: 'SYNC_PENDING_ACTIONS',
                  payload: {}
                }, (response) => {
                  if (response && response.ok) {
                  } else {
                    console.error('[QEFY] Failed to trigger auto-open floating panel sync:', response?.error);
                  }
                });
              }
              
              // Start flickering after a short delay
              setTimeout(() => {
                window.startFlickeringUpNext();
              }, 500);
            } catch (err) {
              // Silent fail for auto-open
            }
          } else if (timeRemaining > 10 && window.autoShowTriggered) {
            // Reset trigger when video is not near end
            window.autoShowTriggered = false;
            window.stopFlickeringUpNext();
          }
        }

        // Auto-move to done when video is in last 0.5 seconds
        if (dur > 0 && cur > 0 && !v.paused) {
          const timeRemaining = dur - cur;
          if (timeRemaining <= 0.5 && timeRemaining > 0 && !window.autoMoveTriggered && !window.videoMoveInProgress) {
            window.autoMoveTriggered = true;
            try {
              // Pause the video
              v.pause();
              
              // Move current video to done folder and navigate to next
              moveCurrentVideoToDoneAndNavigateNext();
            } catch (err) {
              // Silent fail for auto-move
            }
          } else if (timeRemaining > 0.5 && window.autoMoveTriggered) {
            // Reset trigger when video is not near end
            window.autoMoveTriggered = false;
          }
        }

        // Check if playlist has ended (current video is in done folder)
        const playlistEndedMsg = document.getElementById('playlistEndedMsg');
        const playlistSelector = document.getElementById('playlistSelector');
        const folderSelect = document.getElementById('folderSelect');
        
        if (latestQueue && location.href) {
          const found = findItemByUrlInQueue(location.href);
          const foundIncludingDone = findItemByUrlInQueueIncludingDone(location.href);
          
          if (!found && foundIncludingDone && foundIncludingDone.folder === 'done') {
            // Playlist has ended - show message and selector
            if (playlistEndedMsg) playlistEndedMsg.style.display = 'block';
            if (playlistSelector) {
              playlistSelector.style.display = 'block';
              // Only populate if user is not currently interacting with the dropdown
              if (!folderSelect || folderSelect.dataset.userInteracting !== 'true') {
                populateFolderSelector();
              }
            }
          } else {
            // Video is in active playlist or not in queue at all
            // Only hide if user is not interacting with the dropdown
            if (playlistEndedMsg) playlistEndedMsg.style.display = 'none';
            if (playlistSelector && (!folderSelect || folderSelect.dataset.userInteracting !== 'true')) {
              playlistSelector.style.display = 'none';
            }
          }
        }

        computeAndRenderUpNext(location.href);
      }catch(_){ }
    }
    function send(v){
      const now = Date.now();
      if (now - lastSent < 300) return;
      lastSent = now;
      try {
        let title = document.title || '';
        let thumb = '';
        try {
          const md = navigator?.mediaSession?.metadata;
          if (md) {
            title = md.title || title;
            const art = Array.isArray(md.artwork) ? md.artwork : [];
            const first = art.find(a => a && typeof a.src === 'string' && a.src);
            if (first) thumb = first.src;
          }
        } catch (_) {}
        chrome.runtime?.sendMessage({
          type: 'QEFY_MEDIA_PROGRESS',
          payload: {
            url: location.href,
            currentTime: Number(v.currentTime||0),
            duration: Number(v.duration||0),
            paused: !!v.paused,
            title,
            thumb
          }
        }, () => void chrome.runtime?.lastError);
        
        // Send progress update to Real-time Database every 5 seconds or on pause
        const currentSeconds = Number(v.currentTime||0);
        const totalSeconds = Number(v.duration||0);
        const status = v.paused ? 'paused' : 'playing';
        const shouldUpdateProgress = (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) || status === 'paused';
        
        if (shouldUpdateProgress) {
          lastProgressUpdate = now;
          chrome.runtime?.sendMessage({
            type: 'UPDATE_MEDIA_PROGRESS',
            payload: {
              currentSeconds,
              totalSeconds,
              status,
              url: location.href
            }
          }, () => void chrome.runtime?.lastError);
        }
        
        setQefyTitle();
        render(v);
      } catch(_){}
    }
    // Initialize i18n system for floating UI
    async function initializeFloatingUIi18n() {
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

    function wire(){
      const v = pick();
      if (!v) { setTimeout(wire, 800); return; }
      
      // Initialize i18n
      initializeFloatingUIi18n();
      
      // Reset flags for new video
      window.videoMoveInProgress = false;
      window.autoMoveTriggered = false;
      window.autoShowTriggered = false;
      
      const onUpdate = () => { try { send(v); render(v); } catch(_){} };
      const onEnded = () => { 
        // Video ended naturally - move to done and navigate to next
        if (!window.autoMoveTriggered && !window.videoMoveInProgress) {
          window.autoMoveTriggered = true;
          moveCurrentVideoToDoneAndNavigateNext();
        }
      };
      v.addEventListener('timeupdate', onUpdate, { passive: true });
      v.addEventListener('play', onUpdate, { passive: true });
      v.addEventListener('pause', onUpdate, { passive: true });
      v.addEventListener('ended', onEnded, { passive: true });
      setInterval(onUpdate, 1000);
      onUpdate();
      setQefyTitle();

      // Controls send commands to background (runs in MAIN world)
      const toggle = document.getElementById('togglePlayBtn');
      const back = document.getElementById('seekBackBtn');
      const fwd = document.getElementById('seekFwdBtn');
      const speed = document.getElementById('speedSelect');
      const slider = document.getElementById('seekSlider');
      // Play/pause locally to preserve user gesture, fallback via background if it fails
      toggle?.addEventListener('click', ()=>{
        try{
          const m = document.querySelector('video, audio');
          const paused = m ? !!m.paused : true;
          const cmd = paused ? 'play' : 'pause';
          chrome.runtime?.sendMessage({ type: 'POPUP_PLAYER_CONTROL', payload: { cmd } }, () => void chrome.runtime?.lastError);
        }catch(_){
          chrome.runtime?.sendMessage({ type: 'POPUP_PLAYER_CONTROL', payload: { cmd: 'toggle_play' } }, () => void chrome.runtime?.lastError);
        }
      });
      back?.addEventListener('click', ()=>{ try{ chrome.runtime?.sendMessage({ type: 'POPUP_PLAYER_CONTROL', payload: { cmd: 'seek_rel', value: -10 } }, ()=>void chrome.runtime?.lastError); }catch(_){} });
      fwd?.addEventListener('click', ()=>{ try{ chrome.runtime?.sendMessage({ type: 'POPUP_PLAYER_CONTROL', payload: { cmd: 'seek_rel', value: 30 } }, ()=>void chrome.runtime?.lastError); }catch(_){} });
      speed?.addEventListener('change', ()=>{ try{ const r=parseRate(speed.value); chrome.runtime?.sendMessage({ type: 'POPUP_PLAYER_CONTROL', payload: { cmd: 'set_rate', value: r } }, ()=>void chrome.runtime?.lastError); }catch(_){} });
      let sliderLock = false;
      slider?.addEventListener('input', ()=>{
        if(sliderLock) return; sliderLock=true;
        try{ const t=Number(slider.value)||0; chrome.runtime?.sendMessage({ type: 'POPUP_PLAYER_CONTROL', payload: { cmd: 'seekto', value: t } }, ()=>void chrome.runtime?.lastError); }catch(_){ }
        setTimeout(()=>{ sliderLock=false; }, 120);
      });
      
      // Manage Playlist button
    const manageBtn = document.getElementById('managePlaylistBtn');
    manageBtn?.addEventListener('click', ()=>{ try{ chrome.runtime?.sendMessage({ type: 'POPUP_OPEN_APP' }, ()=>void chrome.runtime?.lastError); }catch(_){} });

    // Playlist selector event listeners
    const folderSelect = document.getElementById('folderSelect');
    const playNowBtn = document.getElementById('playNowBtn');
    
    // Track user interaction with dropdown to prevent interference from background updates
    folderSelect?.addEventListener('focus', () => {
      folderSelect.dataset.userInteracting = 'true';
    });
    
    folderSelect?.addEventListener('blur', () => {
      folderSelect.dataset.userInteracting = 'false';
    });
    
    folderSelect?.addEventListener('mousedown', () => {
      folderSelect.dataset.userInteracting = 'true';
    });
    
    folderSelect?.addEventListener('change', () => {
      // Keep the interaction flag for a short time after selection
      setTimeout(() => {
        folderSelect.dataset.userInteracting = 'false';
      }, 100);
    });
    
    playNowBtn?.addEventListener('click', async () => {
      const selectedFolder = folderSelect?.value;
      if (selectedFolder) {
        // Check listener health before important actions
        await checkAndReconnectListener();
        
        chrome.runtime.sendMessage({
          type: 'POPUP_PLAY_NOW',
          payload: { folder: selectedFolder }
        }, (response) => {
          if (response && response.ok) {
          } else {
            console.error('[QEFY] Failed to start playing playlist:', selectedFolder);
          }
        });
      }
    });
      
      // Add hover effects for next button
      const nextBtn = document.getElementById('markDoneNextBtn');
      nextBtn?.addEventListener('mouseenter', ()=>{
        const upNext = document.getElementById('upNext');
        const up1Tile = document.querySelector('#upNext .tile:first-of-type');
        if (upNext && upNext.style.display !== 'none' && up1Tile) {
          up1Tile.classList.add('upnext-item-highlight');
        }
      });
      nextBtn?.addEventListener('mouseleave', ()=>{
        const upNext = document.getElementById('upNext');
        const up1Tile = document.querySelector('#upNext .tile:first-of-type');
        if (upNext && upNext.style.display !== 'none' && up1Tile) {
          up1Tile.classList.remove('upnext-item-highlight');
        }
      });
      
      // Flickering functions for upnext highlight
      window.startFlickeringUpNext = function() {
        if (window.flickerInterval) return; // Already flickering
        
        const upNext = document.getElementById('upNext');
        if (!upNext || upNext.style.display === 'none') return;
        
        const firstTile = upNext.querySelector('.tile:first-of-type');
        if (!firstTile) return;
        
        // Set initial transparent border to prevent layout shift
        firstTile.style.border = '2px solid transparent';
        firstTile.style.borderRadius = '4px';
        
        let isHighlighted = false;
        window.flickerInterval = setInterval(() => {
          if (isHighlighted) {
            firstTile.style.borderColor = '#fbbf24';
            firstTile.style.backgroundColor = '#fef3c7';
          } else {
            firstTile.style.borderColor = 'transparent';
            firstTile.style.backgroundColor = 'transparent';
          }
          isHighlighted = !isHighlighted;
        }, 500); // Flicker every 500ms
        
        // Stop flickering after 10 seconds
        setTimeout(() => {
          window.stopFlickeringUpNext();
        }, 10000);
      };
      
      window.stopFlickeringUpNext = function() {
        if (window.flickerInterval) {
          clearInterval(window.flickerInterval);
          window.flickerInterval = null;
          
          // Reset first tile styling
          const upNext = document.getElementById('upNext');
          if (upNext) {
            const firstTile = upNext.querySelector('.tile:first-of-type');
            if (firstTile) {
              firstTile.style.borderColor = 'transparent';
              firstTile.style.backgroundColor = 'transparent';
            }
          }
        }
      };
      
      // Stop flickering when next button is clicked (reuse existing nextBtn)
      nextBtn?.addEventListener('click', () => {
        stopFlickeringUpNext();
        window.autoShowTriggered = false;
        // Move current video to done and navigate to next
        moveCurrentVideoToDoneAndNavigateNext();
      });

    }
    
    // Listen for immediate status update requests
    chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
      if (message?.type === 'REQUEST_MEDIA_STATUS') {
        try {
          const v = pick();
          if (v) {
            // Immediately send current status
            const currentSeconds = Number(v.currentTime||0);
            const totalSeconds = Number(v.duration||0);
            const status = v.paused ? 'paused' : 'playing';
            
            chrome.runtime?.sendMessage({
              type: 'UPDATE_MEDIA_PROGRESS',
              payload: { 
                currentSeconds, 
                totalSeconds, 
                status,
                url: location.href
              }
            }, () => void chrome.runtime?.lastError);
            
            console.log('[QEFY FloatingUI] Sent immediate media status update:', status);
          }
        } catch (e) {
          console.error('[QEFY FloatingUI] Error sending immediate status:', e);
        }
      }
    });
    
    wire();
  }catch(_){}
})();
