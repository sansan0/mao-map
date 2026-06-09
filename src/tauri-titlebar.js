/*!
 * Tauri 桌面端窗口控制脚本
 * 处理自定义标题栏、托盘事件、桌面设置面板、自动更新检查
 * Android 端：隐藏标题栏和桌面设置，保留更新检查和语言切换
 */

(function () {
  'use strict';

  const TAURI = window.__TAURI_INTERNALS__;
  const IS_ANDROID = /android/i.test(navigator.userAgent);

  // 非 Tauri 环境（浏览器调试）：隐藏标题栏
  if (!TAURI) {
    const titlebar = document.getElementById('titlebar');
    if (titlebar) {
      titlebar.style.display = 'none';
      document.body.style.paddingTop = '0';
    }
    return;
  }

  const invoke = TAURI.invoke;
  const APP_VERSION = '2.2.0';

  const VERSION_SOURCES = [
    'https://sansan0.github.io/mao-map/version.json',
    'https://fastly.jsdelivr.net/gh/sansan0/mao-map@master/version.json',
    'https://cdn.jsdelivr.net/gh/sansan0/mao-map@master/version.json',
    'https://gcore.jsdelivr.net/gh/sansan0/mao-map@master/version.json',
  ];
  let lastOkSourceIndex = 0;

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
      try {
        let data;
        if (IS_ANDROID) {
          const base64 = await Promise.race([
            invoke('proxy_fetch', { url }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
          ]);
          data = JSON.parse(atob(base64));
        } else {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(url, { signal: ctrl.signal });
          clearTimeout(timer);
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
    }
    throw new Error('all sources unavailable');
  }

  function showToast(message, linkText, linkUrl, duration) {
    document.querySelector('.update-toast')?.remove();

    const toast = document.createElement('div');
    toast.className = 'update-toast';
    toast.innerHTML = `<span>${message}</span>`;
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

    setTimeout(() => {
      toast.classList.remove('visible');
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 400);
    }, duration || 5000);
  }

  async function checkForUpdate(manual) {
    try {
      const data = await fetchVersionJson();

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
    }
  }

  window.checkForUpdate = checkForUpdate;

  // ==================== Android 适配 ====================
  // 标题栏/托盘/置顶/自启在 Android 无意义，仅保留更新检查与多语言。
  // 设置承载为底部抽屉（复用 #settings-panel，形态由 tauri.css 的 body.android 声明）。
  // 仅做必要的元素归位与事件绑定，不再 DOM 搬移 + !important 打补丁。

  if (IS_ANDROID) {
    document.body.classList.add('android');

    const init = () => {
      const panel = document.getElementById('settings-panel');

      // 1) 语言选择器从（隐藏的）标题栏移入设置抽屉
      const langSelector = document.getElementById('language-selector');
      if (langSelector && panel) {
        langSelector.classList.remove('titlebar-lang');
        const header = panel.querySelector('.settings-panel-header');
        if (header && header.after) header.after(langSelector);
        else panel.insertBefore(langSelector, panel.firstChild);
      }

      // 2) 设置入口图标改为菜单(☰)，与 toggle 面板按钮(⚙)区分
      const settingsBtn = document.getElementById('settings-btn');
      if (settingsBtn) settingsBtn.textContent = '☰';

      // 3) 检查更新移入镜头控制区末尾（抽屉可见→入口可达，修复原先不可达）
      const checkUpdateBtn = document.getElementById('check-update-btn');
      const cameraSettings = document.querySelector('.camera-settings');
      if (checkUpdateBtn && cameraSettings) {
        const row = checkUpdateBtn.closest('.setting-row');
        if (row) { row.style.display = ''; cameraSettings.appendChild(row); }
        checkUpdateBtn.addEventListener('click', () => checkForUpdate(true));
      }

      // 4) 反馈收进抽屉：新增一行，点击复用既有反馈弹窗
      const feedbackBtn = document.getElementById('feedback-btn');
      if (feedbackBtn && panel) {
        const label = (typeof i18n !== 'undefined' && i18n.t('ui.feedback.title')) || '意见反馈';
        const row = document.createElement('div');
        row.className = 'sheet-feedback-row';
        row.innerHTML = '<span data-i18n="ui.feedback.title">' + label + '</span>'
          + '<span class="sheet-feedback-arrow">›</span>';
        row.addEventListener('click', () => feedbackBtn.click());
        panel.appendChild(row);
      }

      // 5) 启动后静默检查更新
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

  const titlebar = document.getElementById('titlebar');
  if (titlebar) {
    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.titlebar-controls') ||
          e.target.closest('.titlebar-lang') ||
          e.target.closest('button')) {
        return;
      }
      invoke('plugin:window|start_dragging', {
        label: 'main',
      }).catch(() => {});
    });

    titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.titlebar-controls') ||
          e.target.closest('.titlebar-lang') ||
          e.target.closest('button')) {
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

  const SVG_MAXIMIZE = '<svg width="10" height="10" viewBox="0 0 10 10"><rect fill="none" stroke="currentColor" stroke-width="1" x="0.5" y="0.5" width="9" height="9"/></svg>';
  const SVG_RESTORE = '<svg width="10" height="10" viewBox="0 0 10 10"><rect fill="none" stroke="currentColor" stroke-width="1" x="2.5" y="0.5" width="7" height="7"/><rect fill="none" stroke="currentColor" stroke-width="1" x="0.5" y="2.5" width="7" height="7"/></svg>';

  async function updateMaximizeIcon() {
    try {
      const maximized = await invoke('plugin:window|is_maximized', { label: 'main' });
      const btn = document.getElementById('titlebar-maximize');
      if (btn) btn.innerHTML = maximized ? SVG_RESTORE : SVG_MAXIMIZE;
    } catch (e) { /* ignore */ }
  }

  function initControls() {
    document.getElementById('titlebar-minimize')?.addEventListener('click', () => {
      invoke('plugin:window|minimize', { label: 'main' }).catch(() => {});
    });

    document.getElementById('titlebar-maximize')?.addEventListener('click', toggleMaximize);

    document.getElementById('titlebar-close')?.addEventListener('click', () => {
      invoke('plugin:window|hide', { label: 'main' }).catch(() => {});
    });

    window.addEventListener('resize', () => setTimeout(updateMaximizeIcon, 50));
  }

  // ==================== i18n 标题 + 托盘语言同步 ====================

  function setupI18nSync() {
    if (typeof i18n === 'undefined') return;

    const originalSetLocale = i18n.setLocale.bind(i18n);
    i18n.setLocale = async function (locale) {
      const result = await originalSetLocale(locale);
      const titleEl = document.querySelector('.titlebar-title');
      if (titleEl) titleEl.textContent = i18n.t('meta.title');
      invoke('update_tray_language', { language: locale }).catch(() => {});
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

    invoke('load_settings').then(settings => {
      if (topmostToggle) topmostToggle.checked = settings.topmost || false;
    }).catch(() => {});

    invoke('plugin:autostart|is_enabled').then(enabled => {
      if (autostartToggle) autostartToggle.checked = enabled;
    }).catch(() => {});

    if (topmostToggle) {
      topmostToggle.addEventListener('change', () => {
        invoke('set_topmost', { topmost: topmostToggle.checked }).catch(() => {
          topmostToggle.checked = !topmostToggle.checked;
        });
      });
    }

    if (autostartToggle) {
      autostartToggle.addEventListener('change', async () => {
        const want = autostartToggle.checked;
        try {
          if (want) {
            await invoke('plugin:autostart|enable');
          } else {
            await invoke('plugin:autostart|disable');
          }
        } catch (e) {
          autostartToggle.checked = !want;
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
