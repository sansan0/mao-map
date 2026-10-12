/*!
 * 轻量级 i18n 引擎
 * 用于毛泽东生平地理轨迹可视化项目的多语言支持
 */

class I18n {
  constructor(defaultLocale = 'zh-CN') {
    this.locale = defaultLocale;
    this.translations = new Map();
    this.fallbackLocale = 'zh-CN';
    this.supportedLocales = ['zh-CN', 'en'];
  }

  /**
   * 加载语言包
   */
  async loadLocale(locale) {
    if (!this.supportedLocales.includes(locale)) {
      console.warn(`不支持的语言: ${locale}`);
      return false;
    }

    try {
      const response = await fetch(`i18n/${locale}.json`);
      if (!response.ok) {
        throw new Error(`加载语言包失败: ${response.status}`);
      }
      const data = await response.json();
      this.translations.set(locale, data);
      console.log(`语言包加载成功: ${locale}`);
      return true;
    } catch (error) {
      console.error(`Failed to load locale ${locale}:`, error);
      return false;
    }
  }

  /**
   * 设置当前语言
   */
  async setLocale(locale) {
    if (!this.supportedLocales.includes(locale)) {
      console.warn(`不支持的语言: ${locale}`);
      return false;
    }

    if (!this.translations.has(locale)) {
      const loaded = await this.loadLocale(locale);
      if (!loaded) return false;
    }

    this.locale = locale;

    try {
      localStorage.setItem('preferredLocale', locale);
    } catch (error) {
      console.warn('无法保存语言偏好设置:', error);
    }

    this.updateDOM();
    return true;
  }

  /**
   * 获取翻译文本
   * 支持嵌套路径（如 "ui.stats.title"）和变量插值
   */
  t(key, variables = {}) {
    const translation = this.translations.get(this.locale);
    const value = key.split('.').reduce((obj, k) => obj?.[k], translation);

    if (value === undefined || value === null) {
      const fallback = this.translations.get(this.fallbackLocale);
      const fallbackValue = key.split('.').reduce((obj, k) => obj?.[k], fallback);

      if (fallbackValue === undefined || fallbackValue === null) {
        console.warn(`翻译缺失: ${key}`);
        return key;
      }

      return this.interpolate(fallbackValue, variables);
    }

    return this.interpolate(value, variables);
  }

  /**
   * 变量插值："{name}" => 实际值
   */
  interpolate(text, variables) {
    if (typeof text !== 'string') return text;

    return Object.entries(variables).reduce(
      (result, [key, value]) => {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        return result.replace(regex, value);
      },
      text
    );
  }

  /**
   * 更新 DOM 元素（通过 data-i18n 属性）
   */
  updateDOM() {
    document.documentElement.lang = this.locale;
    document.title = this.t('meta.title');

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      const variables = this.parseVariables(el);

      if (!key) return;

      if (attr === 'placeholder') {
        el.placeholder = this.t(key, variables);
      } else if (attr === 'title') {
        el.title = this.t(key, variables);
      } else if (attr === 'aria-label') {
        el.setAttribute('aria-label', this.t(key, variables));
      } else if (attr === 'html') {
        el.innerHTML = this.t(key, variables);
      } else {
        el.textContent = this.t(key, variables);
      }
    });
    document.dispatchEvent(new CustomEvent('journey:locale-change', { detail: { locale: this.locale } }));
  }

  /**
   * 从元素的 data-i18n-vars 属性解析变量
   */
  parseVariables(el) {
    const varsAttr = el.getAttribute('data-i18n-vars');
    if (!varsAttr) return {};

    try {
      return JSON.parse(varsAttr);
    } catch (error) {
      console.warn('解析 i18n 变量失败:', varsAttr, error);
      return {};
    }
  }

  /**
   * 获取浏览器首选语言
   * 优先级：localStorage > URL参数 > 浏览器语言
   */
  getPreferredLocale() {
    try {
      const stored = localStorage.getItem('preferredLocale');
      if (stored && this.supportedLocales.includes(stored)) {
        return stored;
      }
    } catch (error) {
      console.warn('无法读取语言偏好设置:', error);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const langParam = urlParams.get('lang');
    if (langParam && this.supportedLocales.includes(langParam)) {
      return langParam;
    }

    const browserLang = navigator.language || navigator.userLanguage;

    if (browserLang.startsWith('zh')) {
      return 'zh-CN';
    } else if (browserLang.startsWith('en')) {
      return 'en';
    }

    return this.fallbackLocale;
  }

  getCurrentLocale() {
    return this.locale;
  }

  getSupportedLocales() {
    return this.supportedLocales;
  }

  isLocaleLoaded(locale) {
    return this.translations.has(locale);
  }

  /**
   * 预加载所有语言包
   */
  async preloadAll() {
    const promises = this.supportedLocales.map(locale => this.loadLocale(locale));
    await Promise.all(promises);
    console.log('所有语言包预加载完成');
  }
}

// 创建全局实例
const i18n = new I18n();

// 导出（用于模块化）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = i18n;
}
