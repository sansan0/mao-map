/*!
 * Tauri 桌面端窗口控制脚本
 * 处理自定义标题栏、托盘事件、桌面设置面板、自动更新检查
 * Android 端：隐藏标题栏和桌面设置，保留更新检查和语言切换
 */

(function () {
  'use strict';

  const TAURI = window.__TAURI_INTERNALS__;
  const IS_ANDROID = /android/i.test(navigator.userAgent);
  const titlebar = document.getElementById('titlebar');

  document.body.classList.toggle('tauri-desktop', Boolean(TAURI) && !IS_ANDROID);
  document.body.classList.toggle('android', Boolean(TAURI) && IS_ANDROID);
  if (titlebar) titlebar.hidden = !TAURI || IS_ANDROID;

  // 普通浏览器使用共享页面布局，不添加原生窗口的高度偏移。
  if (!TAURI) {
    return;
  }

  const invoke = TAURI.invoke;
  const APP_VERSION = '2.3.0';

  const VERSION_SOURCES = [
    'https://sansan0.github.io/mao-map/version.json',
    'https://fastly.jsdelivr.net/gh/sansan0/mao-map@master/version.json',
    'https://cdn.jsdelivr.net/gh/sansan0/mao-map@master/version.json',
    'https://gcore.jsdelivr.net/gh/sansan0/mao-map@master/version.json',
  ];
  let lastOkSourceIndex = 0;
  let pendingUpdateCheck = null;

  // ==================== 自动更新检查 ====================

  function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    }
    return 0;
  }

  async function fetchVersionJson() {
    const n = VERSION_SOURCES.length;
    for (let offset = 0; offset < n; offset++) {
      const idx = (lastOkSourceIndex + offset) % n;
      const url = VERSION_SOURCES[idx] + '?t=' + Date.now();
      let timer;
      try {
        let data;
        if (IS_ANDROID) {
          const base64 = await Promise.race([
            invoke('proxy_fetch', { url }),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('timeout')), 5000);
            }),
          ]);
          data = JSON.parse(atob(base64));
        } else {
          const ctrl = new AbortController();
          timer = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(url, { signal: ctrl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          data = await res.json();
        }
        if (idx !== lastOkSourceIndex) {
          const host = new URL(VERSION_SOURCES[idx]).hostname;
          console.log(`[Update] switched to: ${host}`);
        }
        lastOkSourceIndex = idx;
        return data;
      } catch { /* try next source */ }
      finally { clearTimeout(timer); }
    }
    throw new Error('all sources unavailable');
  }

  function showToast(message, linkText, linkUrl, duration) {
    document.querySelector('.update-toast')?.remove();

    const toast = document.createElement('div');
    toast.className = 'update-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    const messageEl = document.createElement('span');
    messageEl.textContent = message;
    toast.appendChild(messageEl);
    if (linkText && linkUrl) {
      const link = document.createElement('a');
      link.className = 'update-toast-link';
      link.textContent = linkText;
      link.href = '#';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        invoke('plugin:opener|open_url', { url: linkUrl }).catch(() => {});
      });
      toast.appendChild(document.createTextNode(' '));
      toast.appendChild(link);
    }
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('visible'));
    });

    const dismissToast = () => {
      if (!toast.isConnected) return;
      // 键盘用户正在访问下载链接时，不移除其焦点目标。
      if (toast.contains(document.activeElement)) {
        setTimeout(dismissToast, 1000);
        return;
      }
      toast.classList.remove('visible');
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 400);
    };
    setTimeout(dismissToast, duration || 5000);
  }

  async function checkForUpdate(manual) {
    const button = manual ? document.getElementById('check-update-btn') : null;
    if (button?.disabled) return;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      if (!pendingUpdateCheck) {
        pendingUpdateCheck = fetchVersionJson().finally(() => {
          pendingUpdateCheck = null;
        });
      }
      const data = await pendingUpdateCheck;

      if (compareVersions(APP_VERSION, data.version) < 0) {
        const msg = (typeof i18n !== 'undefined' ? i18n.t('ui.update.updateAvailable') : '').replace('{version}', data.version)
          || `New version v${data.version} available`;
        const linkText = typeof i18n !== 'undefined' ? i18n.t('ui.update.download') : 'Download';
        showToast(msg, linkText, data.url, 8000);
      } else if (manual) {
        const msg = typeof i18n !== 'undefined' ? i18n.t('ui.update.alreadyLatest') : 'Already up to date';
        showToast(msg, null, null, 3000);
      }
    } catch (e) {
      if (manual) {
        const msg = typeof i18n !== 'undefined' ? i18n.t('ui.update.networkError') : 'Network unavailable';
        showToast(msg, null, null, 3000);
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  window.checkForUpdate = checkForUpdate;

  // ==================== Android 适配 ====================
  // 标题栏/托盘/置顶/自启在 Android 无意义，仅保留更新检查与多语言。
  // 设置复用 #settings-panel；其余导航和操作与网页共享。

  if (IS_ANDROID) {
    const init = () => {
      const panel = document.getElementById('settings-panel');

      // 语言入口从页面顶栏归入设置，不创建第二份选择器。
      const langSelector = document.getElementById('language-selector');
      if (langSelector && panel) {
        langSelector.classList.remove('titlebar-lang');
        const languageSection = document.getElementById('settings-language');
        if (languageSection) {
          if (langSelector.parentElement !== languageSection) languageSection.appendChild(langSelector);
          languageSection.hidden = false;
        } else {
          const header = panel.querySelector('.settings-panel-header');
          if (header && header.after) header.after(langSelector);
          else panel.insertBefore(langSelector, panel.firstChild);
        }
      }

      // 检查更新不随桌面专用设置隐藏。
      const checkUpdateBtn = document.getElementById('check-update-btn');
      const cameraSettings = document.querySelector('.camera-settings');
      if (checkUpdateBtn && cameraSettings) {
        const row = checkUpdateBtn.closest('.setting-row');
        if (row) { row.style.display = ''; cameraSettings.appendChild(row); }
        checkUpdateBtn.addEventListener('click', () => checkForUpdate(true));
      }

      setTimeout(() => checkForUpdate(false), 3000);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }

    return;
  }

  // ==================== 以下为桌面端专属逻辑 ====================

  // ==================== 窗口拖拽 ====================

  if (titlebar) {
    titlebar.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.defaultPrevented ||
          e.target.closest('button, a, input, select, textarea, [contenteditable="true"]')) {
        return;
      }
      invoke('plugin:window|start_dragging', {
        label: 'main',
      }).catch(() => {});
    });

    titlebar.addEventListener('dblclick', (e) => {
      if (e.defaultPrevented ||
          e.target.closest('button, a, input, select, textarea, [contenteditable="true"]')) {
        return;
      }
      toggleMaximize();
    });
  }

  // ==================== 窗口控制按钮 ====================

  async function toggleMaximize() {
    try {
      const maximized = await invoke('plugin:window|is_maximized', { label: 'main' });
      if (maximized) {
        await invoke('plugin:window|unmaximize', { label: 'main' });
      } else {
        await invoke('plugin:window|maximize', { label: 'main' });
      }
      updateMaximizeIcon();
    } catch (e) {
      console.warn('窗口操作失败:', e);
    }
  }

  let windowMaximized = false;

  function renderWindowControlIcon(id, name) {
    const button = document.getElementById(id);
    if (button && window.JourneyIcons?.svg) {
      button.innerHTML = window.JourneyIcons.svg(name);
    }
  }

  function updateWindowControlLabels() {
    const english = typeof i18n !== 'undefined' && i18n.locale === 'en';
    const labels = {
      'titlebar-minimize': english ? 'Minimize' : '最小化',
      'titlebar-maximize': windowMaximized
        ? (english ? 'Restore window' : '还原窗口')
        : (english ? 'Maximize' : '最大化'),
      'titlebar-close': english ? 'Hide to tray' : '隐藏到托盘',
    };
    Object.entries(labels).forEach(([id, label]) => {
      const button = document.getElementById(id);
      if (!button) return;
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.querySelectorAll('svg').forEach(svg => {
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
      });
    });
    const controls = document.querySelector('.titlebar-controls');
    if (controls) {
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', english ? 'Window controls' : '窗口控制');
    }
  }

  async function updateMaximizeIcon() {
    try {
      const maximized = await invoke('plugin:window|is_maximized', { label: 'main' });
      windowMaximized = maximized;
      renderWindowControlIcon('titlebar-maximize', maximized ? 'copy' : 'square');
      updateWindowControlLabels();
    } catch (e) { /* ignore */ }
  }

  function initControls() {
    renderWindowControlIcon('titlebar-minimize', 'minus');
    renderWindowControlIcon('titlebar-maximize', 'square');
    renderWindowControlIcon('titlebar-close', 'x');
    updateWindowControlLabels();
    updateMaximizeIcon();

    document.getElementById('titlebar-minimize')?.addEventListener('click', () => {
      invoke('plugin:window|minimize', { label: 'main' }).catch(() => {});
    });

    document.getElementById('titlebar-maximize')?.addEventListener('click', toggleMaximize);

    document.getElementById('titlebar-close')?.addEventListener('click', () => {
      invoke('plugin:window|hide', { label: 'main' }).catch(() => {});
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateMaximizeIcon, 50);
    });
  }

  // ==================== i18n 标题 + 托盘语言同步 ====================

  function setupI18nSync() {
    if (typeof i18n === 'undefined') return;

    const originalSetLocale = i18n.setLocale.bind(i18n);
    i18n.setLocale = async function (locale) {
      const result = await originalSetLocale(locale);
      if (result === false) return result;
      const titleEl = document.querySelector('.titlebar-title');
      if (titleEl) titleEl.textContent = i18n.t('meta.title');
      updateWindowControlLabels();
      invoke('update_tray_language', { language: i18n.locale }).catch(() => {});
      return result;
    };
  }

  // ==================== 托盘事件监听 ====================

  function listenEvent(event, callback) {
    TAURI.invoke('plugin:event|listen', {
      event: event,
      target: { kind: 'Any' },
      handler: TAURI.transformCallback((e) => callback(e.payload)),
    }).catch(() => {});
  }

  function setupTrayEvents() {
    listenEvent('topmost-changed', (checked) => {
      window.dispatchEvent(new CustomEvent('tauri-topmost-changed', { detail: checked }));
      const toggle = document.getElementById('topmost-toggle');
      if (toggle) toggle.checked = checked;
    });

    listenEvent('autostart-changed', (checked) => {
      const toggle = document.getElementById('autostart-toggle');
      if (toggle) toggle.checked = checked;
    });

    listenEvent('check-update', () => {
      checkForUpdate(true);
    });
  }

  // ==================== 桌面设置面板 ====================

  function initDesktopSettings() {
    document.querySelectorAll('.tauri-only-settings').forEach(el => {
      el.style.display = '';
    });

    const topmostToggle = document.getElementById('topmost-toggle');
    const autostartToggle = document.getElementById('autostart-toggle');
    const checkUpdateBtn = document.getElementById('check-update-btn');

    if (topmostToggle) topmostToggle.disabled = true;
    invoke('load_settings').then(settings => {
      if (topmostToggle) topmostToggle.checked = settings.topmost === true;
    }).catch(() => {}).finally(() => {
      if (topmostToggle) topmostToggle.disabled = false;
    });

    if (autostartToggle) autostartToggle.disabled = true;
    invoke('plugin:autostart|is_enabled').then(enabled => {
      if (autostartToggle) autostartToggle.checked = enabled === true;
    }).catch(() => {}).finally(() => {
      if (autostartToggle) autostartToggle.disabled = false;
    });

    if (topmostToggle) {
      topmostToggle.addEventListener('change', async () => {
        const want = topmostToggle.checked;
        topmostToggle.disabled = true;
        try {
          await invoke('set_topmost', { topmost: want });
        } catch (e) {
          topmostToggle.checked = !want;
        } finally {
          topmostToggle.disabled = false;
        }
      });
    }

    if (autostartToggle) {
      autostartToggle.addEventListener('change', async () => {
        const want = autostartToggle.checked;
        autostartToggle.disabled = true;
        try {
          await invoke('set_autostart', { enabled: want });
        } catch (e) {
          autostartToggle.checked = !want;
        } finally {
          autostartToggle.disabled = false;
        }
      });
    }

    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', () => checkForUpdate(true));
    }
  }

  // ==================== 初始化 ====================

  function init() {
    initControls();
    setupI18nSync();
    setupTrayEvents();
    initDesktopSettings();
    setTimeout(() => checkForUpdate(false), 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
