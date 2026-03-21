/*!
 * Tauri 桌面端窗口控制脚本
 * 处理自定义标题栏、托盘事件、桌面设置面板、自动更新检查
 */

(function () {
  'use strict';

  const TAURI = window.__TAURI_INTERNALS__;

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
  const APP_VERSION = '2.0.1';
  const VERSION_URL = 'https://sansan0.github.io/mao-map/version.json';

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
    // 托盘 → 置顶变更
    listenEvent('topmost-changed', (checked) => {
      window.dispatchEvent(new CustomEvent('tauri-topmost-changed', { detail: checked }));
      const toggle = document.getElementById('topmost-toggle');
      if (toggle) toggle.checked = checked;
    });

    // 托盘 → 开机启动变更
    listenEvent('autostart-changed', (checked) => {
      const toggle = document.getElementById('autostart-toggle');
      if (toggle) toggle.checked = checked;
    });

    // 托盘 → 检查更新
    listenEvent('check-update', () => {
      checkForUpdate(true);
    });
  }

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

  function showToast(message, linkText, linkUrl, duration) {
    // 移除已有 toast
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
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(VERSION_URL + '?t=' + Date.now(), { signal: ctrl.signal });
      const data = await res.json();

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
      // 非手动触发：完全静默
    }
  }

  // 暴露给设置面板按钮
  window.checkForUpdate = checkForUpdate;

  // ==================== 桌面设置面板 ====================

  function initDesktopSettings() {
    // 显示 Tauri 专属设置区
    document.querySelectorAll('.tauri-only-settings').forEach(el => {
      el.style.display = '';
    });

    const topmostToggle = document.getElementById('topmost-toggle');
    const autostartToggle = document.getElementById('autostart-toggle');
    const checkUpdateBtn = document.getElementById('check-update-btn');

    // 加载初始状态
    invoke('load_settings').then(settings => {
      if (topmostToggle) topmostToggle.checked = settings.topmost || false;
    }).catch(() => {});

    invoke('plugin:autostart|is_enabled').then(enabled => {
      if (autostartToggle) autostartToggle.checked = enabled;
    }).catch(() => {});

    // 置顶切换
    if (topmostToggle) {
      topmostToggle.addEventListener('change', () => {
        invoke('set_topmost', { topmost: topmostToggle.checked }).catch(() => {
          topmostToggle.checked = !topmostToggle.checked;
        });
      });
    }

    // 开机启动切换
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
          // 回滚
          autostartToggle.checked = !want;
        }
      });
    }

    // 检查更新按钮
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

    // 启动后 3 秒静默检查更新
    setTimeout(() => checkForUpdate(false), 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
