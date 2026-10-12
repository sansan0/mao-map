import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

export async function readProjectJSON(relativePath) {
  return JSON.parse(await readProjectFile(relativePath));
}

export async function until(condition, description, timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

/**
 * Executes the actual local application in a DOM, not a browser. No network
 * resources are enabled. Only tile delivery, audio and unavailable layout APIs
 * are substituted; Leaflet, motion, application scripts and JSON stay real.
 */
export async function createApp({
  entry = 'index.html',
  width = 1440,
  height = 900,
  reducedMotion = true,
  baseURL = 'https://mao-map.test/',
  nativeAndroid = false,
  nativePlatform = null,
  storage = {},
  rects = {},
  fetchOverrides = {},
  waitForReady = true,
} = {}) {
  const appVersion = (await readProjectJSON('package.json')).version;
  const errors = [];
  const warnings = [];
  const requests = [];
  const requestURLs = [];
  const tileLayers = [];
  const clipboard = [];
  const nativeCalls = [];
  const mediaQueries = new Set();
  const rectangles = new Map(Object.entries(rects));
  let viewportWidth = width;
  let viewportHeight = height;
  let disposed = false;
  let nativeWindowMaximized = false;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  virtualConsole.on('warn', (...args) => warnings.push(args.map(String).join(' ')));

  const dom = new JSDOM(await readProjectFile(entry), {
    url: new URL(entry, baseURL).href,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const { document } = window;
  const context = dom.getInternalVMContext();
  const basePath = new URL('.', window.location.href).pathname;
  const evaluate = (source, filename = 'test-expression.js') =>
    new vm.Script(source, { filename }).runInContext(context);

  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: 'zh-CN', configurable: true });
  window.localStorage.setItem('preferredLocale', 'zh-CN');
  Object.entries(storage).forEach(([key, value]) => window.localStorage.setItem(key, String(value)));
  const platform = nativeAndroid ? 'android' : nativePlatform;
  if (platform) {
    const agents = {
      android: ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36', 'Linux armv8l'],
      windows: ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Win32'],
      macos: ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36', 'MacIntel'],
    };
    const [userAgent, navigatorPlatform] = agents[platform];
    Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
    Object.defineProperty(window.navigator, 'platform', { value: navigatorPlatform, configurable: true });
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (command, args) => {
        nativeCalls.push({ command, args });
        if (command === 'proxy_fetch') return window.btoa(JSON.stringify({ version: appVersion }));
        if (command === 'load_settings') return { topmost: false };
        if (command === 'plugin:window|is_maximized') return nativeWindowMaximized;
        if (command === 'plugin:window|maximize') { nativeWindowMaximized = true; return null; }
        if (command === 'plugin:window|unmaximize') { nativeWindowMaximized = false; return null; }
        if (command === 'plugin:autostart|is_enabled') return false;
        return null;
      },
    };
  }

  const matchesMedia = (query) => query.split(',').some((part) => {
    if (part.includes('prefers-reduced-motion')) return reducedMotion;
    const constraints = [...part.matchAll(/(min|max)-(width|height):\s*([\d.]+)px/g)];
    if (!constraints.length) return false;
    return constraints.every(([, bound, axis, limit]) => {
      const actual = axis === 'width' ? viewportWidth : viewportHeight;
      return bound === 'min' ? actual >= Number(limit) : actual <= Number(limit);
    });
  });
  window.matchMedia = (query) => {
    const result = new window.EventTarget();
    Object.defineProperties(result, {
      media: { value: query },
      matches: { get: () => matchesMedia(query) },
    });
    result.addListener = (listener) => result.addEventListener('change', listener);
    result.removeListener = (listener) => result.removeEventListener('change', listener);
    mediaQueries.add(result);
    return result;
  };
  const setViewport = ({ width: nextWidth = viewportWidth, height: nextHeight = viewportHeight }) => {
    const before = new Map([...mediaQueries].map((query) => [query, query.matches]));
    viewportWidth = nextWidth;
    viewportHeight = nextHeight;
    Object.defineProperty(window, 'innerWidth', { value: nextWidth, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: nextHeight, configurable: true });
    for (const query of mediaQueries) {
      if (before.get(query) === query.matches) continue;
      const event = new window.Event('change');
      Object.assign(event, { matches: query.matches, media: query.media });
      query.dispatchEvent(event);
    }
    window.dispatchEvent(new window.Event('resize'));
  };

  window.SVGSVGElement.prototype.createSVGRect = () => ({});
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
    this.dataset.testScrolledIntoView = 'true';
  };
  window.HTMLElement.prototype.scrollTo = function scrollTo(options) {
    this.scrollTop = typeof options === 'object' ? options.top || 0 : 0;
  };
  window.HTMLElement.prototype.setPointerCapture = function setPointerCapture(pointerId) {
    this.testCapturedPointer = pointerId;
  };
  window.HTMLElement.prototype.releasePointerCapture = function releasePointerCapture() {
    delete this.testCapturedPointer;
  };
  window.HTMLElement.prototype.hasPointerCapture = function hasPointerCapture(pointerId) {
    return this.testCapturedPointer === pointerId;
  };
  if (!('inert' in window.HTMLElement.prototype)) {
    Object.defineProperty(window.HTMLElement.prototype, 'inert', {
      configurable: true,
      get() { return this.hasAttribute('inert'); },
      set(value) { this.toggleAttribute('inert', Boolean(value)); },
    });
  }
  for (const property of ['clientWidth', 'offsetWidth']) {
    Object.defineProperty(window.HTMLElement.prototype, property, {
      configurable: true,
      get() { return this.id === 'map' ? rectangles.get('map')?.width ?? viewportWidth : viewportWidth; },
    });
  }
  for (const property of ['clientHeight', 'offsetHeight']) {
    Object.defineProperty(window.HTMLElement.prototype, property, {
      configurable: true,
      get() { return this.id === 'map' ? rectangles.get('map')?.height ?? 640 : 80; },
    });
  }
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    // Geometry is a controlled fixture, not an estimate of browser layout.
    // By default the visible frame covers the map; browse occlusion tests provide both rectangles.
    const fallback = this.id === 'playback-dock'
      ? { left: 40, top: document.body.dataset.viewMode === 'browse' ? 700 : 550, width: Math.max(240, viewportWidth - 80), height: 80 }
      : this.id === 'map-stage' ? rectangles.get('map') || { left: 0, top: 0, width: viewportWidth, height: 640 }
      : { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
    const { left, top, width: boxWidth, height: boxHeight } = rectangles.get(this.id) || fallback;
    return { x: left, y: top, left, top, width: boxWidth, height: boxHeight, right: left + boxWidth, bottom: top + boxHeight, toJSON() { return this; } };
  };
  window.HTMLElement.prototype.getClientRects = function getClientRects() {
    for (let current = this; current; current = current.parentElement) {
      if (current.hidden || current.inert) return [];
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
    }
    return [this.getBoundingClientRect()];
  };
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.HTMLMediaElement.prototype.load = function load() {};
  window.HTMLMediaElement.prototype.pause = function pause() {};
  window.HTMLMediaElement.prototype.play = async function play() {};
  window.URL.createObjectURL = () => 'blob:local-test';
  window.URL.revokeObjectURL = () => {};
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async (text) => { clipboard.push(text); } },
    configurable: true,
  });

  window.fetch = async (input) => {
    const url = new URL(String(input), window.location.href);
    if (url.origin !== window.location.origin) {
      throw new Error(`External network access is disabled in tests: ${url.origin}`);
    }
    requestURLs.push(url.href);
    if (!url.pathname.startsWith(basePath)) throw new Error(`Fetch escaped the hosted project subpath: ${url.pathname}`);
    const relativePath = decodeURIComponent(url.pathname.slice(basePath.length));
    requests.push(relativePath);
    if (Object.hasOwn(fetchOverrides, relativePath)) {
      const override = fetchOverrides[relativePath];
      if (override instanceof Error) throw override;
      if (typeof override === 'function') return override();
      return { ok: true, status: 200, json: async () => structuredClone(override) };
    }
    const filePath = path.resolve(projectRoot, relativePath);
    if (!filePath.startsWith(projectRoot)) throw new Error('Fetch path escaped project root');
    try {
      const body = await readFile(filePath, 'utf8');
      return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false, status: 404, statusText: 'Not Found' };
    }
  };

  // Let JSDOM's initial parse finish once; application scripts then take their
  // normal readyState branch. Script elements themselves never fetch or run.
  if (document.readyState === 'loading') {
    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  for (const link of [...document.querySelectorAll('link[rel="stylesheet"][href]')]) {
    const source = link.getAttribute('href');
    if (/^https?:|^\/\//.test(source)) throw new Error(`Entry must use local stylesheets: ${source}`);
    const style = document.createElement('style');
    style.dataset.testSource = source;
    style.textContent = await readProjectFile(source.replace(/^\//, ''));
    document.head.appendChild(style);
  }

  for (const script of [...document.querySelectorAll('script[src]')]) {
    if (script.type === 'module') continue; // Native Tauri bridge is separately checked as a resource.
    const source = script.getAttribute('src');
    if (/^https?:|^\/\//.test(source)) throw new Error(`Entry must use local scripts: ${source}`);
    const scriptPath = source.replace(/^\//, '');
    evaluate(await readProjectFile(scriptPath), scriptPath);
    if (/leaflet\.js$/.test(scriptPath)) {
      const originalTileLayer = window.L.tileLayer;
      window.L.tileLayer = (...args) => {
        const layer = originalTileLayer(...args);
        tileLayers.push(layer);
        return layer;
      };
      window.L.TileLayer.prototype.createTile = function createTile(_coords, done) {
        const tile = document.createElement('div');
        queueMicrotask(() => { if (!disposed) done?.(null, tile); });
        return tile;
      };
    }
  }

  const app = {
    dom, window, document, evaluate, errors, warnings, requests, requestURLs, tileLayers, clipboard, nativeCalls,
    setViewport,
    setWidth: (nextWidth) => setViewport({ width: nextWidth }),
    setRect: (id, rectangle) => rectangle ? rectangles.set(id, rectangle) : rectangles.delete(id),
    $: (selector) => document.querySelector(selector),
    $$: (selector) => [...document.querySelectorAll(selector)],
    close: () => { disposed = true; window.close(); },
    key: (target, key, options = {}) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })),
    pointer: (target, type, options = {}) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, ...options });
      target.dispatchEvent(event);
    },
    input: (element, value) => {
      element.value = value;
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
  };
  if (waitForReady) {
    try {
      await until(() => window.JourneyMap?.getEvents().length > 0 && document.querySelector('#loading')?.style.display === 'none', `${entry} initialization`);
    } catch (error) {
      disposed = true;
      window.close();
      throw new Error(`${error.message}\n${errors.join('\n')}`);
    }
  }
  return app;
}
