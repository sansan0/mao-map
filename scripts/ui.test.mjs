import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createApp, projectRoot, readProjectJSON, until } from './test-support/app-harness.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const savedPreferences = (app) => Object.fromEntries(Object.keys(app.window.localStorage).map((key) => [key, app.window.localStorage.getItem(key)]));
const openApp = async (t, options) => {
  const app = await createApp(options);
  t.after(() => app.close());
  return app;
};
const setViewMode = (app, mode) => {
  const button = app.$(`button[data-view-mode="${mode}"]`);
  assert.ok(button, `${mode} has a visible mode control`);
  button.click();
  assert.equal(app.document.body.dataset.viewMode, mode);
  return button;
};
const setSkin = (app, skin) => {
  const select = app.$('#skin-select');
  assert.ok(select);
  select.value = skin;
  select.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.equal(app.document.body.dataset.skin, skin);
};
const selectControls = (app, id) => {
  const select = app.$(`#${id}`);
  const trigger = app.$(`#${id}-trigger`);
  const listbox = app.$(`#${id}-listbox`);
  assert.ok(select && trigger && listbox, `${id} exposes its value source, visible trigger and menu`);
  return { select, trigger, listbox };
};
const openSelect = (app, id) => {
  const controls = selectControls(app, id);
  controls.trigger.focus();
  controls.trigger.click();
  assert.equal(controls.trigger.getAttribute('aria-expanded'), 'true');
  assert.ok(controls.listbox.getClientRects().length);
  assert.equal(app.document.activeElement, controls.trigger);
  return controls;
};
const chooseSelect = (app, id, value) => {
  const controls = openSelect(app, id);
  const option = [...controls.listbox.querySelectorAll('[role="option"]')].find((candidate) => candidate.dataset.value === value);
  assert.ok(option, `${id} has the ${value} option`);
  option.click();
  assert.equal(controls.select.value, value);
  assert.equal(controls.trigger.getAttribute('aria-expanded'), 'false');
  return controls;
};
const assertLucide = (element, name) => {
  assert.ok(element, 'the icon host exists');
  const icons = [...element.querySelectorAll('svg')];
  assert.equal(icons.length, 1, `${element.id || element.className} has one inline icon`);
  const icon = icons[0];
  assert.ok(icon.classList.contains('lucide'));
  assert.match(icon.getAttribute('data-lucide') || '', /^[a-z][a-z0-9-]*$/);
  if (name) assert.equal(icon.getAttribute('data-lucide'), name);
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.getAttribute('focusable'), 'false');
  assert.ok(icon.querySelector('path, line, polyline, polygon, circle, rect, ellipse'));
  assert.equal(icon.querySelector('image, use'), null, 'the icon does not fetch an external image or sprite');
  return icon;
};

test('HTML and Tauri entries initialize the same local Chinese application', async (t) => {
  const sharedIds = [];
  for (const entry of ['index.html', 'tauri.html']) {
    const app = await openApp(t, { entry });
    const { document, window } = app;
    assert.equal(document.documentElement.lang, 'zh-CN');
    assert.equal(window.JourneyMap.getEvents().length, 109);
    assert.equal(window.JourneyMap.getCurrentIndex(), 0);
    assert.match(app.$('#event-title').textContent, /毛泽东出生/);
    assert.equal(app.$('#timeline-slider').max, '108');
    const ids = app.$$('#container [id]').map((element) => element.id).sort();
    assert.equal(new Set(ids).size, ids.length, `${entry} has no duplicated shared IDs`);
    sharedIds.push(ids);
    for (const resource of app.$$('script[src], link[rel="stylesheet"][href], img[src]')) {
      const source = resource.getAttribute('src') || resource.getAttribute('href');
      if (/^data:|^blob:/.test(source)) continue;
      assert.doesNotMatch(source, /^(https?:)?\/\//, `${entry} must bundle ${source}`);
      await access(path.join(projectRoot, source.replace(/^\//, '')));
    }
    assert.deepEqual(app.errors, [], `${entry} must initialize without runtime errors`);
  }
  assert.deepEqual(sharedIds[0], sharedIds[1]);
});

test('a fresh visit defaults to paper skin and the compact playback presentation', async (t) => {
  const app = await openApp(t);
  assert.equal(app.document.body.dataset.viewMode, 'playback');
  assert.equal(app.document.body.dataset.skin, 'paper');
  assert.equal(app.$('#skin-select').value, 'paper');
  assert.equal(app.$('meta[name="theme-color"]').content, '#f6f3ec');
  assert.equal(app.$$('header button[data-view-mode]').length, 2);
  assert.equal(app.$('button[data-view-mode="playback"]').getAttribute('aria-pressed'), 'true');
  assert.equal(app.$('button[data-view-mode="browse"]').getAttribute('aria-pressed'), 'false');
  assert.equal(app.$('#journey-sidebar').inert, true);
  assert.equal(app.$('#journey-search').getClientRects().length, 0);
  for (const id of ['playback-speed', 'skin-select', 'period-select']) {
    const { select, trigger, listbox } = selectControls(app, id);
    assert.equal(select.hidden, true);
    assert.equal(trigger.getAttribute('role'), 'combobox');
    assert.equal(trigger.getAttribute('aria-controls'), listbox.id);
    assert.equal(listbox.getAttribute('role'), 'listbox');
    assert.equal(listbox.parentElement, app.document.body);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  }
  assert.equal(app.window.JourneyMap.getCurrentIndex(), 0);
  assert.equal(app.window.JourneyMap.isPlaying(), false);
  assert.deepEqual(app.errors, []);
});

test('both static entries load local Lucide icons with decorative SVG semantics', async (t) => {
  for (const entry of ['index.html', 'tauri.html']) {
    const baseURL = 'https://example.github.io/mao-map/';
    const app = await openApp(t, { entry, baseURL });
    assert.equal(typeof app.window.JourneyIcons?.svg, 'function');
    const source = app.$('script[src="libs/lucide/icons.js"]');
    assert.ok(source);
    assert.ok(source.src.startsWith(baseURL));
    await access(path.join(projectRoot, 'libs/lucide/LICENSE'));
    for (const selector of [
      '#music-btn', '#feedback-btn', '#settings-btn', '#journey-toggle', '#journey-close',
      '#focus-current', '#fit-journey', '#prev-btn', '#play-btn', '#next-btn',
      '#event-card-toggle', '#read-event', '#settings-panel-close',
      '#music-prev-btn', '#music-play-btn', '#music-next-btn',
      '#zoom-in', '#zoom-out', '#map-tools-toggle',
    ]) assertLucide(app.$(selector));
    for (const chevron of app.$$('.select-chevron')) assertLucide(chevron, 'chevron-down');
    for (const check of app.$$('.select-option-check')) assertLucide(check, 'check');
    assert.ok(app.requestURLs.every((url) => url.startsWith(baseURL)));
    assert.deepEqual(app.errors, []);
  }
});

test('timeline and music icons follow loading, play, pause and replay without losing accessible names', async (t) => {
  const app = await openApp(t);
  const api = app.window.JourneyMap;
  const playback = app.$('#play-btn');
  assertLucide(playback, 'play');
  assert.match(playback.getAttribute('aria-label'), /播放/);
  playback.click();
  assertLucide(playback, 'pause');
  assert.match(playback.getAttribute('aria-label'), /暂停/);
  assert.equal(playback.getAttribute('aria-pressed'), 'true');
  playback.click();
  assertLucide(playback, 'play');
  assert.match(playback.getAttribute('aria-label'), /播放/);
  assert.equal(playback.getAttribute('aria-pressed'), 'false');
  api.goTo(108);
  assertLucide(playback, 'rotate-ccw');
  assert.match(playback.getAttribute('aria-label'), /重播/);
  playback.click();
  assert.equal(api.getCurrentIndex(), 0);
  assertLucide(playback, 'pause');
  playback.click();

  app.$('#music-btn').focus();
  app.$('#music-btn').click();
  await until(() => app.$('#music-modal').contains(app.document.activeElement), 'music icon state dialog');
  const music = app.$('#music-play-btn');
  const audio = app.$('#music-audio');
  Object.defineProperty(audio, 'readyState', { configurable: true, get: () => 4 });
  assertLucide(music, 'play');
  music.click();
  assertLucide(music, 'loader-circle');
  assert.match(music.getAttribute('aria-label'), /加载/);
  await until(() => app.evaluate('isMusicPlaying'), 'ready media play state');
  assertLucide(music, 'pause');
  assert.match(music.getAttribute('aria-label'), /暂停/);
  music.click();
  assertLucide(music, 'play');
  assert.match(music.getAttribute('aria-label'), /播放/);
  assert.equal(app.evaluate('isMusicPlaying'), false);
  assert.deepEqual(app.errors, []);
});

test('native desktop titlebar icons and accessible labels follow maximize and restore commands', async (t) => {
  for (const nativePlatform of ['windows', 'macos']) {
    const app = await openApp(t, { entry: 'tauri.html', nativePlatform });
    const maximize = app.$('#titlebar-maximize');
    assert.equal(app.$('#titlebar').hidden, false);
    assertLucide(app.$('#titlebar-minimize'), 'minus');
    assertLucide(app.$('#titlebar-close'), 'x');
    assertLucide(maximize, 'square');
    assert.match(maximize.getAttribute('aria-label'), /最大化/);
    maximize.click();
    await until(() => maximize.querySelector('svg')?.getAttribute('data-lucide') === 'copy', `${nativePlatform} maximize icon`);
    assertLucide(maximize, 'copy');
    assert.match(maximize.getAttribute('aria-label'), /还原/);
    maximize.click();
    await until(() => maximize.querySelector('svg')?.getAttribute('data-lucide') === 'square', `${nativePlatform} restore icon`);
    assertLucide(maximize, 'square');
    assert.match(maximize.getAttribute('aria-label'), /最大化/);
    app.$('#titlebar-minimize').click();
    app.$('#titlebar-close').click();
    for (const command of ['maximize', 'unmaximize', 'minimize', 'hide']) {
      assert.ok(app.nativeCalls.some((call) => call.command === `plugin:window|${command}` && call.args.label === 'main'));
    }
    assert.match(app.$('#titlebar-close').getAttribute('aria-label'), /托盘/);
    assert.deepEqual(app.errors, []);
  }
});

test('changing view mode preserves the selected event and playback on desktop and compact screens', async (t) => {
  for (const width of [1440, 375]) {
    const app = await openApp(t, { width });
    const api = app.window.JourneyMap;
    api.goTo(20);
    api.togglePlay();
    const timer = app.evaluate('playInterval');
    app.$('#play-btn').focus();
    for (const mode of ['browse', 'playback']) {
      setViewMode(app, mode);
      await Promise.resolve();
      assert.equal(api.getCurrentIndex(), 20);
      assert.equal(api.isPlaying(), true, `${width}px mode switch keeps playback running`);
      assert.equal(app.evaluate('playInterval'), timer);
      assert.equal(app.document.body.dataset.skin, 'paper');
      assert.equal(app.window.localStorage.getItem('mao-map:view-mode'), mode);
      assert.equal(app.document.activeElement, app.$('#play-btn'), 'moving the player between layouts preserves its active control');
    }
    api.togglePlay();
    assert.deepEqual(app.errors, []);
  }
});

test('settings skin changes preserve view mode, current motion, map layers and the playback timer', async (t) => {
  const app = await openApp(t, { reducedMotion: false });
  const api = app.window.JourneyMap;
  api.setRouteScope('current');
  api.goTo(2);
  app.$('#next-btn').click();
  api.togglePlay();
  const currentIndex = api.getCurrentIndex();
  const pathLayer = app.evaluate('pathLayers[0]');
  const pathElement = pathLayer._path;
  const timer = app.evaluate('playInterval');
  assert.ok(pathLayer.animation, 'the real motion plugin has an active animation');
  for (const [mode, skin] of [['playback', 'classic'], ['browse', 'paper']]) {
    setViewMode(app, mode);
    const trigger = app.$('#settings-btn');
    trigger.focus();
    trigger.click();
    await until(() => app.$('#settings-panel').contains(app.document.activeElement), 'appearance settings focus');
    assert.equal(api.isPlaying(), true, 'opening appearance settings keeps the journey playing');
    chooseSelect(app, 'skin-select', skin);
    await Promise.resolve();
    assert.ok(app.$('#settings-panel').classList.contains('visible'), 'portal menu selection must not dismiss its settings owner');
    assert.equal(app.document.body.dataset.viewMode, mode);
    assert.equal(api.getCurrentIndex(), currentIndex);
    assert.equal(api.isPlaying(), true);
    assert.equal(app.evaluate('playInterval'), timer);
    assert.equal(app.evaluate('pathLayers[0]'), pathLayer);
    assert.equal(pathLayer._path, pathElement);
    assert.ok(pathLayer.animation);
    assert.equal(app.window.localStorage.getItem('mao-map:skin'), skin);
    app.$('#settings-panel-close').click();
    await until(() => app.document.activeElement === trigger, 'appearance settings focus return');
  }
  api.togglePlay();
  assert.deepEqual(app.errors, []);
});

test('stored mode and skin preferences restore independently and invalid values fall back safely', async (t) => {
  const cases = [
    [{ 'mao-map:view-mode': 'browse', 'mao-map:skin': 'paper' }, 'browse', 'paper'],
    [{ 'mao-map:view-mode': 'browse', 'mao-map:skin': 'classic' }, 'browse', 'classic'],
    [{ 'mao-map:view-mode': 'invalid', 'mao-map:skin': 'paper' }, 'playback', 'paper'],
    [{ 'mao-map:view-mode': 'browse', 'mao-map:skin': '<invalid>' }, 'browse', 'paper'],
    [{ 'mao-map:view-mode': '', 'mao-map:skin': '' }, 'playback', 'paper'],
  ];
  for (const [storage, mode, skin] of cases) {
    const app = await openApp(t, { storage });
    assert.equal(app.document.body.dataset.viewMode, mode);
    assert.equal(app.document.body.dataset.skin, skin);
    assert.equal(app.$('#skin-select').value, skin);
    assert.equal(app.$(`button[data-view-mode="${mode}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(app.$('#journey-sidebar').inert, mode === 'playback');
    assert.deepEqual(app.errors, []);
  }
  const original = await openApp(t);
  setViewMode(original, 'browse');
  setSkin(original, 'classic');
  const saved = Object.fromEntries(['mao-map:view-mode', 'mao-map:skin'].map((key) => [key, original.window.localStorage.getItem(key)]));
  const restored = await openApp(t, { storage: saved });
  assert.equal(restored.document.body.dataset.viewMode, 'browse');
  assert.equal(restored.document.body.dataset.skin, 'classic');
});

test('glass settings apply live, survive skin and mode changes, and restore across web and native entries', async (t) => {
  for (const options of [
    { entry: 'index.html', baseURL: 'https://example.github.io/mao-map/' },
    { entry: 'tauri.html', nativePlatform: 'windows' },
    { entry: 'tauri.html', nativePlatform: 'macos' },
    { entry: 'tauri.html', nativeAndroid: true, width: 375 },
  ]) {
    const app = await openApp(t, options);
    const transparency = app.$('#glass-transparency');
    const blur = app.$('#glass-blur');
    assert.equal(transparency.value, '35');
    assert.equal(blur.value, '5');
    assert.equal(app.document.body.style.getPropertyValue('--glass-alpha'), '0.65');
    assert.equal(app.document.body.style.getPropertyValue('--glass-blur'), '5px');
    app.$('#settings-btn').click();
    app.input(transparency, '58');
    app.input(blur, '24');
    assert.equal(app.document.body.style.getPropertyValue('--glass-alpha'), '0.42');
    assert.equal(app.document.body.style.getPropertyValue('--glass-blur'), '24px');
    assert.equal(app.$('#glass-transparency-display').textContent, '58%');
    assert.equal(app.$('#glass-blur-display').textContent, '24px');
    assert.equal(transparency.getAttribute('aria-valuetext'), '58%');
    assert.equal(blur.getAttribute('aria-valuetext'), '24px');
    assert.equal(transparency.style.getPropertyValue('--range-progress'), '72.5%');
    assert.equal(blur.style.getPropertyValue('--range-progress'), '80%');
    setSkin(app, 'classic');
    app.$('#settings-panel-close').click();
    setViewMode(app, 'browse');
    assert.equal(app.document.body.style.getPropertyValue('--glass-alpha'), '0.42');
    assert.equal(app.document.body.style.getPropertyValue('--glass-blur'), '24px');
    const storage = savedPreferences(app);
    assert.equal(storage['mao-map:glass-transparency'], '58');
    assert.equal(storage['mao-map:glass-blur'], '24');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(app.errors, []);
    app.close();

    const restored = await openApp(t, { ...options, storage });
    assert.equal(restored.document.body.dataset.skin, 'classic');
    assert.equal(restored.document.body.dataset.viewMode, 'browse');
    assert.equal(restored.$('#glass-transparency').value, '58');
    assert.equal(restored.$('#glass-blur').value, '24');
    assert.equal(restored.document.body.style.getPropertyValue('--glass-alpha'), '0.42');
    assert.equal(restored.document.body.style.getPropertyValue('--glass-blur'), '24px');
    setSkin(restored, 'paper');
    setViewMode(restored, 'playback');
    assert.equal(restored.document.body.style.getPropertyValue('--glass-alpha'), '0.42');
    assert.equal(restored.document.body.style.getPropertyValue('--glass-blur'), '24px');
    assert.equal(restored.window.JourneyMap.isPlaying(), false);
    assert.deepEqual(restored.errors, []);
  }
});

test('glass preference restoration accepts zero and endpoints while rejecting corrupt storage', async (t) => {
  for (const [transparency, blur, expectedAlpha, expectedBlur] of [
    ['0', '0', '1', '0px'],
    ['80', '30', '0.2', '30px'],
    ['', ' ', '0.65', '5px'],
    ['Infinity', 'bad', '0.65', '5px'],
    ['81', '-1', '0.65', '5px'],
  ]) {
    const app = await openApp(t, { storage: { 'mao-map:glass-transparency': transparency, 'mao-map:glass-blur': blur } });
    assert.equal(app.document.body.style.getPropertyValue('--glass-alpha'), expectedAlpha);
    assert.equal(app.document.body.style.getPropertyValue('--glass-blur'), expectedBlur);
    assert.equal(app.$('#glass-transparency-display').textContent, `${app.$('#glass-transparency').value}%`);
    assert.equal(app.$('#glass-blur-display').textContent, `${app.$('#glass-blur').value}px`);
    assert.deepEqual(app.errors, []);
  }
});

test('period, source disclosure and route preferences restore together without navigating the map on startup', async (t) => {
  for (const options of [{ entry: 'index.html' }, { entry: 'tauri.html', nativeAndroid: true, width: 375 }]) {
    const app = await openApp(t, options);
    setViewMode(app, 'browse');
    if (app.$('#journey-sidebar').inert) app.$('#journey-toggle').click();
    chooseSelect(app, 'period-select', 'yanan');
    const expectedCount = app.$$('#journey-list .journey-item').length;
    if (app.document.body.classList.contains('archive-drawer')) app.$('#journey-close').click();
    if (!app.$('#map-tools-toggle').hidden) app.$('#map-tools-toggle').click();
    app.$('button[data-scope="current"]').click();
    app.$('#read-event').click();
    await until(() => app.window.localStorage.getItem('mao-map:source-expanded') === 'true', 'source preference save');
    const storage = savedPreferences(app);
    assert.equal(storage['mao-map:period'], 'yanan');
    assert.equal(storage['mao-map:route-scope'], 'current');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(app.errors, []);
    app.close();

    const restored = await openApp(t, { ...options, storage });
    assert.equal(restored.$('#period-select').value, 'yanan');
    assert.equal(restored.$$('#journey-list .journey-item').length, expectedCount);
    assert.match(restored.$('#period-select-trigger').textContent, /延安/);
    assert.equal(restored.window.JourneyMap.getRouteScope(), 'current');
    assert.equal(restored.$('button[data-scope="current"]').getAttribute('aria-pressed'), 'true');
    assert.equal(restored.document.body.classList.contains('scope-current'), true);
    assert.equal(restored.$('#event-source').open, true);
    assert.equal(restored.$('#read-event').getAttribute('aria-expanded'), 'true');
    assert.equal(restored.window.JourneyMap.getCurrentIndex(), 0, 'restoring preferences does not seek to a filtered event');
    assert.equal(restored.window.JourneyMap.isPlaying(), false);
    if (restored.$('#journey-sidebar').inert) restored.$('#journey-toggle').click();
    restored.$('#find-current').click();
    assert.equal(restored.$('#period-select').value, 'all');
    assert.equal(restored.$$('#journey-list .journey-item').length, 109);
    assert.equal(restored.window.localStorage.getItem('mao-map:period'), 'all');
    if (restored.document.body.classList.contains('archive-drawer')) restored.$('#journey-close').click();
    restored.$('#read-event').click();
    await until(() => restored.window.localStorage.getItem('mao-map:source-expanded') === 'false', 'source preference closes');
    assert.deepEqual(restored.errors, []);
  }
});

test('camera and music preferences reopen with matching controls and keep media paused', async (t) => {
  for (const options of [{ entry: 'index.html' }, { entry: 'tauri.html', nativeAndroid: true, width: 375 }]) {
    const app = await openApp(t, { ...options, storage: { cameraFollowEnabled: 'false' } });
    app.$('#follow-mode-selector [data-mode="path"]').click();
    app.input(app.$('#follow-zoom-slider'), '8.5');
    app.input(app.$('#path-speed-multiplier'), '3.5');
    chooseSelect(app, 'playback-speed', '3');
    app.input(app.$('#music-volume-slider'), '27');
    app.$('.playlist-item[data-index="1"]').click();
    const songTitle = app.$('#current-song-title').textContent;
    const storage = savedPreferences(app);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(app.errors, []);
    app.close();

    const restored = await openApp(t, { ...options, storage });
    assert.equal(restored.evaluate('cameraFollowMode'), 'path');
    assert.equal(restored.evaluate('isCameraFollowEnabled'), true, 'legacy false must not override the new mode');
    assert.equal(restored.$('#follow-mode-selector [data-mode="path"]').getAttribute('aria-pressed'), 'true');
    assert.equal(restored.$('#follow-zoom-row').style.display, 'flex');
    assert.equal(restored.$('#follow-zoom-slider').value, '8.5');
    assert.equal(restored.evaluate('pathFollowZoom'), 8.5);
    assert.equal(restored.$('#path-speed-multiplier').value, '3.5');
    assert.equal(restored.evaluate('pathSpeedMultiplier'), 3.5);
    assert.equal(restored.$('#playback-speed').value, '3');
    assert.equal(restored.evaluate('currentSpeedLevel'), 3);
    assert.equal(restored.$('#music-volume-slider').value, '27');
    assert.equal(restored.$('#music-volume-slider').style.getPropertyValue('--range-progress'), '27%');
    assert.equal(restored.$('#music-volume-value').textContent, '27%');
    assert.equal(restored.$('#music-audio').volume, 0.27);
    assert.equal(restored.$('#current-song-title').textContent, songTitle);
    assert.equal(restored.evaluate('currentMusicIndex'), 1);
    assert.equal(restored.evaluate('isMusicPlaying'), false);
    assert.equal(restored.window.JourneyMap.isPlaying(), false);
    assert.deepEqual(restored.errors, []);
  }
});

test('invalid stored camera and media values are normalized before rendering or playback', async (t) => {
  const app = await openApp(t, { storage: {
    cameraFollowMode: 'path', cameraFollowEnabled: 'false', pathFollowZoom: '7.3',
    pathSpeedMultiplier: '99', speedLevel: '2junk', musicVolume: 'NaN', 'mao-map:music-song': 'missing-song',
  } });
  assert.equal(app.evaluate('isCameraFollowEnabled'), true);
  assert.equal(app.$('#follow-zoom-slider').value, '7.5');
  assert.equal(app.evaluate('pathFollowZoom'), 7.5);
  assert.equal(app.$('#path-speed-multiplier').value, '5');
  assert.equal(app.evaluate('pathSpeedMultiplier'), 5);
  assert.equal(app.$('#playback-speed').value, '1');
  assert.equal(app.$('#music-volume-slider').value, '50');
  assert.equal(app.$('#music-audio').volume, 0.5);
  assert.equal(app.evaluate('currentMusicIndex'), 0);
  assert.deepEqual(app.errors, []);
});

test('leaving browse mode hides its focus targets and restores focus to an available mode control', async (t) => {
  const app = await openApp(t);
  setViewMode(app, 'browse');
  const sidebar = app.$('#journey-sidebar');
  const search = app.$('#journey-search');
  assert.equal(sidebar.inert, false);
  assert.ok(search.getClientRects().length > 0);
  search.focus();
  const playback = setViewMode(app, 'playback');
  assert.equal(sidebar.inert, true);
  assert.equal(search.getClientRects().length, 0);
  assert.equal(app.document.activeElement, playback);
  assert.equal(app.document.activeElement.closest('[inert]'), null);
  setViewMode(app, 'browse');
  assert.equal(sidebar.inert, false);
  assert.ok(search.getClientRects().length > 0);
  assert.equal(app.document.activeElement.closest('[inert]'), null);
  assert.deepEqual(app.errors, []);
});

test('folding the event description restores focus and preserves playback across modes', async (t) => {
  const app = await openApp(t);
  setViewMode(app, 'browse');
  const api = app.window.JourneyMap;
  const card = app.$('#current-event-card');
  const toggle = app.$('#event-card-toggle');
  const read = app.$('#read-event');
  assert.equal(toggle.getAttribute('aria-controls'), card.id);
  assert.equal(card.hidden, false);
  api.goTo(20);
  api.togglePlay();
  const timer = app.evaluate('playInterval');
  read.focus();
  toggle.click();
  assert.equal(app.document.activeElement, toggle);
  assert.equal(card.hidden, true);
  assert.equal(card.inert, true);
  assert.equal(read.getClientRects().length, 0);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(app.document.body.classList.contains('event-collapsed'));
  assert.equal(app.window.localStorage.getItem('mao-map:event-collapsed'), 'true');

  setViewMode(app, 'playback');
  assert.equal(card.hidden, true, 'event folding is independent of view mode');
  assert.equal(app.document.activeElement, toggle);
  toggle.click();
  assert.equal(card.hidden, false);
  assert.equal(card.inert, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(app.window.localStorage.getItem('mao-map:event-collapsed'), 'false');
  assert.equal(api.getCurrentIndex(), 20);
  assert.equal(api.isPlaying(), true);
  assert.equal(app.evaluate('playInterval'), timer);
  assert.equal(app.document.activeElement.closest('[hidden], [inert]'), null);
  api.togglePlay();
  assert.deepEqual(app.errors, []);
});

test('desktop browse archive can close and reopen without losing its separate drawer behavior', async (t) => {
  const app = await openApp(t);
  setViewMode(app, 'browse');
  const sidebar = app.$('#journey-sidebar');
  const trigger = app.$('#journey-toggle');
  const search = app.$('#journey-search');
  search.focus();
  app.$('#journey-close').click();
  assert.equal(sidebar.inert, true);
  assert.equal(sidebar.hidden, true);
  assert.equal(search.getClientRects().length, 0);
  assert.equal(app.document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.ok(app.document.body.classList.contains('archive-collapsed'));
  assert.equal(app.window.localStorage.getItem('mao-map:archive-collapsed'), 'true');

  setViewMode(app, 'playback');
  assert.ok(app.document.body.classList.contains('archive-drawer'));
  assert.equal(app.document.body.classList.contains('archive-collapsed'), false);
  trigger.focus();
  trigger.click();
  assert.equal(sidebar.inert, false);
  assert.equal(sidebar.getAttribute('role'), 'dialog');
  assert.equal(app.document.activeElement, search);
  app.key(search, 'Escape');
  assert.equal(sidebar.inert, true);
  assert.equal(app.document.activeElement, trigger);
  assert.equal(app.window.localStorage.getItem('mao-map:archive-collapsed'), 'true', 'drawer dismissal keeps the desktop archive preference');

  setViewMode(app, 'browse');
  assert.equal(sidebar.inert, true);
  assert.equal(app.document.body.classList.contains('archive-drawer'), false);
  trigger.click();
  assert.equal(sidebar.inert, false);
  assert.equal(sidebar.hidden, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(app.document.activeElement, search);
  assert.equal(app.window.localStorage.getItem('mao-map:archive-collapsed'), 'false');
  assert.equal(sidebar.hasAttribute('aria-modal'), false);
  assert.deepEqual(app.errors, []);
});

test('the archive trigger disappears behind its open panel and returns with usable focus after dismissal', async (t) => {
  for (const width of [1440, 375]) {
    for (const mode of ['playback', 'browse']) {
      const app = await openApp(t, { width });
      setViewMode(app, mode);
      const trigger = app.$('#journey-toggle');
      const sidebar = app.$('#journey-sidebar');
      if (!sidebar.inert) {
        assert.equal(trigger.hidden, true);
        app.$('#journey-close').click();
      }
      for (const dismiss of ['close', 'escape', 'select']) {
        assert.equal(trigger.hidden, false);
        trigger.focus();
        trigger.click();
        assert.equal(trigger.hidden, true, 'the map entry must not show through the translucent archive');
        assert.equal(trigger.getAttribute('aria-expanded'), 'true');
        assert.equal(sidebar.inert, false);
        assert.equal(app.document.activeElement, app.$('#journey-search'));
        if (dismiss === 'escape' && app.document.body.classList.contains('archive-drawer')) app.key(app.$('#journey-search'), 'Escape');
        else if (dismiss === 'select' && app.document.body.classList.contains('archive-drawer')) app.$('.journey-item').click();
        else app.$('#journey-close').click();
        assert.equal(trigger.hidden, false);
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(app.document.activeElement, trigger);
        assert.equal(trigger.closest('[hidden], [inert]'), null);
      }
      assert.deepEqual(app.errors, []);
    }
  }
});

test('event and archive fold preferences accept only stored booleans and do not affect mode or skin', async (t) => {
  for (const [saved, collapsed] of [['true', true], ['false', false], ['invalid', false]]) {
    const app = await openApp(t, { storage: {
      'mao-map:view-mode': 'browse',
      'mao-map:skin': 'paper',
      'mao-map:event-collapsed': saved,
      'mao-map:archive-collapsed': saved,
    } });
    assert.equal(app.document.body.dataset.viewMode, 'browse');
    assert.equal(app.document.body.dataset.skin, 'paper');
    assert.equal(app.$('#current-event-card').hidden, collapsed);
    assert.equal(app.$('#current-event-card').inert, collapsed);
    assert.equal(app.$('#event-card-toggle').getAttribute('aria-expanded'), String(!collapsed));
    assert.equal(app.$('#journey-sidebar').hidden, collapsed);
    assert.equal(app.$('#journey-sidebar').inert, collapsed);
    assert.equal(app.$('#journey-toggle').getAttribute('aria-expanded'), String(!collapsed));
    assert.equal(app.document.body.classList.contains('event-collapsed'), collapsed);
    assert.equal(app.document.body.classList.contains('archive-collapsed'), collapsed);
    assert.deepEqual(app.errors, []);
  }
});

test('one archive summary follows desktop and drawer layouts while keeping current-event access and focus safe', async (t) => {
  const app = await openApp(t);
  const api = app.window.JourneyMap;
  const summary = app.$('.player-caption');
  const sidebar = app.$('#journey-sidebar');
  const find = app.$('#find-current');
  const results = app.$('#journey-results');
  const trigger = app.$('#journey-toggle');
  const heading = app.document.getElementById(sidebar.getAttribute('aria-labelledby'));
  assert.ok(heading?.textContent.trim(), 'removing a visible title keeps the archive accessible name');
  assert.ok(heading.classList.contains('sr-only'));
  const assertUnique = () => {
    assert.equal(app.$$('.player-caption').length, 1);
    assert.equal(app.$('.player-caption'), summary);
    for (const id of ['current-event-index-desktop', 'total-event-count-desktop', 'journey-results', 'find-current']) {
      assert.equal(app.$$(`[id="${id}"]`).length, 1);
      assert.ok(summary.contains(app.$(`#${id}`)));
    }
  };
  api.goTo(20);
  assertUnique();
  assert.equal(app.$('#current-event-index-desktop').textContent, '21');
  assert.equal(app.$('#total-event-count-desktop').textContent, '109');
  assert.ok(results.classList.contains('sr-only'), 'the unfiltered archive does not repeat the visible total');
  trigger.focus();
  trigger.click();
  assert.equal(summary.parentElement, sidebar);
  assert.ok(find.getClientRects().length);
  app.input(app.$('#journey-search'), '无此地点-999999');
  assert.equal(results.classList.contains('sr-only'), false);
  assert.equal(results.getAttribute('role'), 'status');
  assert.equal(app.$('#journey-empty').hidden, false);
  find.focus();
  find.click();
  assert.equal(app.$('#journey-search').value, '');
  assert.equal(app.$('#period-select').value, 'all');
  assert.equal(app.$$('#journey-list .journey-item').length, 109);
  assert.equal(app.document.activeElement.dataset.index, '20');
  assert.equal(api.getCurrentIndex(), 20);
  assert.ok(results.classList.contains('sr-only'));

  find.focus();
  setViewMode(app, 'browse');
  assert.equal(summary.parentElement, app.$('#timeline-control'));
  assert.equal(app.document.activeElement, find);
  assert.equal(find.closest('[hidden], [inert]'), null);
  const playback = setViewMode(app, 'playback');
  assert.equal(summary.parentElement, sidebar);
  assert.equal(app.document.activeElement, playback);
  assert.equal(app.document.activeElement.closest('[hidden], [inert]'), null);

  setViewMode(app, 'browse');
  find.focus();
  app.setWidth(375);
  assert.equal(summary.parentElement, sidebar);
  assert.equal(app.document.activeElement, trigger);
  trigger.click();
  assert.ok(find.getClientRects().length);
  find.focus();
  app.$('#journey-close').click();
  assert.equal(app.document.activeElement, trigger);
  app.setWidth(1440);
  assert.equal(summary.parentElement, app.$('#timeline-control'));
  find.focus();
  app.$('#journey-close').click();
  assert.equal(summary.hidden, true);
  assert.equal(app.document.activeElement, trigger);
  trigger.click();
  assert.equal(summary.hidden, false);
  assert.equal(app.document.activeElement.closest('[hidden], [inert]'), null);
  assertUnique();
  assert.equal(api.getCurrentIndex(), 20);
  assert.deepEqual(app.errors, []);
});

test('HTML, Windows, macOS and Android share mode and skin behavior with static project resources', async (t) => {
  const surfaces = [
    { entry: 'index.html', baseURL: 'https://example.github.io/mao-map/' },
    { entry: 'tauri.html', nativePlatform: 'windows' },
    { entry: 'tauri.html', nativePlatform: 'macos' },
    { entry: 'tauri.html', nativePlatform: 'android' },
  ];
  for (const surface of surfaces) {
    const app = await openApp(t, surface);
    assert.equal(app.document.body.dataset.viewMode, 'playback');
    assert.equal(app.document.body.dataset.skin, 'paper');
    assert.equal(app.window.JourneyMap.getEvents().length, 109);
    if (surface.nativePlatform === 'android') {
      assert.ok(app.document.body.classList.contains('android'));
      assert.equal(app.$('#titlebar').hidden, true);
    } else if (surface.nativePlatform) {
      assert.ok(app.document.body.classList.contains('tauri-desktop'));
      assert.equal(app.$('#titlebar').hidden, false);
    }
    setViewMode(app, 'browse');
    setSkin(app, 'classic');
    assert.equal(app.document.body.dataset.viewMode, 'browse');
    assert.equal(app.document.body.dataset.skin, 'classic');
    assert.equal(app.window.JourneyMap.getCurrentIndex(), 0);
    const ids = app.$$('#container [id]').map((element) => element.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(app.requestURLs.every((url) => new URL(url).origin === new URL(app.window.location.href).origin));
    if (surface.baseURL) assert.ok(app.requestURLs.every((url) => url.startsWith(surface.baseURL)));
    assert.deepEqual(app.errors, [], `${surface.nativePlatform || 'HTML'} shares the same runtime contracts`);
  }
});

test('compact map tools disclose without pausing playback and dismiss without consuming map gestures', async (t) => {
  for (const surface of [{ entry: 'index.html' }, { entry: 'tauri.html', nativePlatform: 'android' }]) {
    const app = await openApp(t, { ...surface, width: 375 });
    const trigger = app.$('#map-tools-toggle');
    const panel = app.$('#map-tool-panel');
    const api = app.window.JourneyMap;
    assert.equal(trigger.hidden, false);
    assert.equal(panel.hidden, true);
    assert.equal(app.$('#zoom-in').getClientRects().length, 0);
    assertLucide(trigger, 'map');
    api.goTo(20);
    api.togglePlay();
    trigger.focus();
    trigger.click();
    assert.equal(panel.hidden, false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assertLucide(trigger, 'x');
    assert.equal(api.isPlaying(), true, 'opening tools is not a modal or a playback action');
    assert.equal(panel.closest('[inert]'), null);
    api.togglePlay();
    app.evaluate('map.setZoom(5, { animate: false })');
    const zoom = app.$('#zoom-in');
    zoom.focus();
    zoom.click();
    zoom.click();
    assert.equal(app.evaluate('map.getZoom()'), 7, 'consecutive zoom taps still work');
    assert.equal(panel.hidden, false);
    assert.equal(app.key(zoom, 'Tab'), true, 'Tab can move into and through the tool group');
    app.$('#zoom-out').focus();
    assert.equal(panel.hidden, false);
    app.key(app.$('#zoom-out'), 'Escape');
    assert.equal(panel.hidden, true);
    assert.equal(app.document.activeElement, trigger);
    trigger.click();
    const pointer = new app.window.Event('pointerdown', { bubbles: true, cancelable: true });
    let delivered = false;
    app.$('#map').addEventListener('pointerdown', () => { delivered = true; }, { once: true });
    app.$('#map').dispatchEvent(pointer);
    assert.equal(panel.hidden, true);
    assert.equal(pointer.defaultPrevented, false);
    assert.equal(delivered, true, 'the dismissing gesture still reaches the map');
    trigger.click();
    app.$('#focus-current').focus();
    app.$('#focus-current').click();
    assert.equal(panel.hidden, true);
    assert.equal(app.document.activeElement, trigger);
    assert.deepEqual(app.errors, []);
  }
});

test('map disclosure preserves usable focus across layout changes and closes before dialogs', async (t) => {
  const app = await openApp(t);
  const trigger = app.$('#map-tools-toggle');
  const panel = app.$('#map-tool-panel');
  const zoom = app.$('#zoom-in');
  assert.equal(trigger.hidden, true);
  assert.equal(panel.hidden, false);
  zoom.focus();
  app.setWidth(375);
  assert.equal(panel.hidden, true);
  assert.equal(app.document.activeElement, trigger);
  trigger.click();
  zoom.focus();
  app.setWidth(1440);
  assert.equal(panel.hidden, false);
  assert.equal(trigger.hidden, true);
  assert.equal(app.document.activeElement, zoom);
  app.setWidth(375);
  assert.equal(app.document.activeElement, trigger);
  app.setWidth(1440);
  assert.equal(app.document.activeElement.closest('[hidden], [inert]'), null);
  assert.equal(app.document.activeElement, zoom);
  assert.ok(app.document.activeElement.getClientRects().length);
  app.setWidth(375);
  trigger.click();
  app.window.dispatchEvent(new app.window.Event('resize'));
  assert.equal(panel.hidden, false, 'a layout notification without viewport change does not dismiss tools');
  app.setViewport({ height: 600 });
  assert.equal(panel.hidden, true);
  trigger.click();
  setViewMode(app, 'browse');
  assert.equal(panel.hidden, true);
  trigger.click();
  zoom.focus();
  app.$('#settings-btn').click();
  await until(() => app.$('#settings-panel').contains(app.document.activeElement), 'settings focus after tools');
  assert.equal(panel.hidden, true);
  assert.ok(trigger.closest('[inert]'));
  app.key(app.document.activeElement, 'Escape');
  await until(() => app.$('#settings-panel').inert, 'settings close after tools');
  assert.equal(trigger.closest('[inert]'), null);
  assert.equal(panel.hidden, true);
  assert.deepEqual(app.errors, []);
});

test('map tool popovers stay in the map bounds and open beside the trigger in short maps', async (t) => {
  const app = await openApp(t, {
    width: 400, height: 360,
    rects: {
      map: { left: 0, top: 70, width: 400, height: 96 },
      'map-tools-toggle': { left: 344, top: 80, width: 44, height: 44 },
      'map-tool-panel': { left: 0, top: 0, width: 192, height: 80 },
    },
  });
  app.$('#map-tools-toggle').click();
  const popup = app.$('#map-tool-panel');
  assert.equal(popup.style.maxHeight, '80px');
  assert.equal(popup.style.left, '144px');
  assert.equal(popup.style.top, '78px');
  assert.ok(Number.parseFloat(popup.style.left) + 192 < 344, 'the popup leaves the trigger uncovered');
  assert.deepEqual(app.errors, []);
});

test('map framing reserves floating playback dock overlap and releases it outside the map', async (t) => {
  const app = await openApp(t, {
    rects: {
      map: { left: 0, top: 0, width: 1000, height: 700 },
      'playback-dock': { left: 100, top: 600, width: 800, height: 90 },
    },
  });
  const inset = plain(app.evaluate('getJourneyMapPadding()'));
  assert.ok(inset.paddingBottomRight[1] > inset.paddingTopLeft[1]);
  assert.ok(inset.paddingBottomRight[1] >= 100, 'map framing includes the dock and the space below it');
  app.evaluate(`{
    const originalFitBounds = map.fitBounds;
    map.fitBounds = function (bounds, options) {
      window.testLastMapFit = options;
      return originalFitBounds.call(this, bounds, options);
    };
  }`);
  app.window.JourneyMap.focusCurrent();
  assert.deepEqual(plain(app.window.testLastMapFit.paddingBottomRight), inset.paddingBottomRight);
  app.window.JourneyMap.fitJourney();
  assert.deepEqual(plain(app.window.testLastMapFit.paddingBottomRight), inset.paddingBottomRight);
  app.setRect('playback-dock', { left: 100, top: 720, width: 800, height: 90 });
  const clear = plain(app.evaluate('getJourneyMapPadding()'));
  assert.deepEqual(clear.paddingTopLeft, [40, 40]);
  assert.deepEqual(clear.paddingBottomRight, [40, 40]);
  assert.deepEqual(app.errors, []);
});

test('one full-shell map survives mode changes and stays isolated behind dialogs and the archive', async (t) => {
  for (const options of [{ entry: 'index.html' }, { entry: 'tauri.html', nativeAndroid: true, width: 375 }]) {
    const app = await openApp(t, options);
    const mapElement = app.$('#map');
    const mapInstance = app.evaluate('map');
    assert.equal(mapElement.parentElement, app.$('#container'));
    assert.equal(app.$$('#map').length, 1);
    assert.equal(app.$('#map-stage').contains(mapElement), false, 'the reading grid must not clip the shared map background');
    for (const mode of ['browse', 'playback']) {
      setViewMode(app, mode);
      assert.equal(app.evaluate('map'), mapInstance, 'mode changes retain the real map and its layers');
      assert.equal(mapElement.inert, false);
      app.$('#settings-btn').focus();
      app.$('#settings-btn').click();
      await until(() => app.$('#settings-panel').contains(app.document.activeElement), 'settings modal map isolation');
      assert.equal(mapElement.inert, true);
      app.$('#settings-panel-close').click();
      await until(() => !mapElement.inert, 'settings releases the separate map');
    }
    app.$('#journey-toggle').focus();
    app.$('#journey-toggle').click();
    assert.equal(mapElement.inert, true);
    app.key(app.$('#journey-search'), 'Escape');
    assert.equal(mapElement.inert, false);
    assert.equal(app.document.activeElement, app.$('#journey-toggle'));
    assert.deepEqual(app.errors, []);
  }
});

test('browse framing keeps the route in the exposed map when reading panels cover the shared background', async (t) => {
  const app = await openApp(t, {
    entry: 'tauri.html', nativePlatform: 'windows', width: 1440, height: 900,
    rects: {
      map: { left: 0, top: 32, width: 1440, height: 868 },
      'map-stage': { left: 320, top: 110, width: 1120, height: 520 },
    },
  });
  setViewMode(app, 'browse');
  assert.deepEqual(plain(app.evaluate('getJourneyMapPadding()')), {
    paddingTopLeft: [360, 118], paddingBottomRight: [40, 310],
  });
  const visibleCenter = app.evaluate(`(() => {
    const target = L.latLng(28, 112);
    map.setView(getJourneyCameraCenter(target, 7), 7, { animate: false });
    return { point: map.latLngToContainerPoint(target), visible: isJourneyPointVisible(target) };
  })()`);
  assert.ok(Math.abs(visibleCenter.point.x - 880) <= 1);
  assert.ok(Math.abs(visibleCenter.point.y - 338) <= 1);
  assert.equal(visibleCenter.visible, true);
  app.evaluate('window.testZoomAnchor = map.containerPointToLatLng([880, 338])');
  for (const [id, shiftKey, zoom] of [['zoom-in', false, 8], ['zoom-in', true, 10], ['zoom-out', true, 7], ['zoom-out', true, 4]]) {
    app.$(`#${id}`).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, shiftKey }));
    assert.equal(app.evaluate('map.getZoom()'), zoom);
    const point = app.evaluate('map.latLngToContainerPoint(window.testZoomAnchor)');
    assert.ok(Math.abs(point.x - 880) <= 1, 'zoom preserves the visible horizontal anchor');
    assert.ok(Math.abs(point.y - 338) <= 1, 'zoom preserves the visible vertical anchor');
  }
  assert.equal(app.$('#zoom-out').disabled, true);
  app.$('#journey-close').click();
  app.setRect('map-stage', { left: 0, top: 110, width: 1440, height: 520 });
  assert.deepEqual(plain(app.evaluate('getJourneyMapPadding()')), {
    paddingTopLeft: [40, 118], paddingBottomRight: [40, 310],
  });
  app.setRect('map-stage', { left: 320, top: 110, width: 60, height: 40 });
  const small = plain(app.evaluate('getJourneyMapPadding()'));
  assert.ok(1440 - small.paddingTopLeft[0] - small.paddingBottomRight[0] > 0);
  assert.ok(868 - small.paddingTopLeft[1] - small.paddingBottomRight[1] > 0);
  app.setRect('map-stage', { left: 1500, top: 110, width: 60, height: 40 });
  assert.deepEqual(plain(app.evaluate('getJourneyMapPadding()')), {
    paddingTopLeft: [40, 40], paddingBottomRight: [40, 40],
  });
  assert.deepEqual(app.errors, []);
});

test('the visible speed selector stages keyboard navigation and commits a new value only once', async (t) => {
  const app = await openApp(t);
  const api = app.window.JourneyMap;
  api.goTo(20);
  const { select, trigger, listbox } = openSelect(app, 'playback-speed');
  const changes = [];
  select.addEventListener('change', () => changes.push(select.value));
  const initial = select.value;
  const activeValue = () => app.document.getElementById(trigger.getAttribute('aria-activedescendant'))?.dataset.value;
  for (const [key, candidate] of [['End', '3'], ['Home', '0'], ['ArrowDown', '1'], ['ArrowDown', '2'], ['ArrowUp', '1'], ['End', '3']]) {
    app.key(trigger, key);
    assert.equal(activeValue(), candidate);
    assert.equal(select.value, initial, 'highlighting a candidate does not change playback speed');
    assert.equal(app.document.activeElement, trigger);
    assert.equal(api.getCurrentIndex(), 20, 'selector keys cannot navigate the background map');
    assert.equal(api.isPlaying(), false);
    assert.deepEqual(changes, []);
  }
  app.key(trigger, 'Enter');
  assert.equal(select.value, '3');
  assert.deepEqual(changes, ['3']);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(listbox.getClientRects().length, 0);

  app.key(trigger, ' ');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  app.key(trigger, 'Home');
  app.key(trigger, ' ');
  assert.equal(select.value, '0');
  assert.deepEqual(changes, ['3', '0']);
  chooseSelect(app, 'playback-speed', '0');
  assert.deepEqual(changes, ['3', '0'], 'reconfirming the selected value does not emit a redundant change');
  chooseSelect(app, 'playback-speed', '2');
  assert.deepEqual(changes, ['3', '0', '2']);
  assert.equal(listbox.querySelectorAll('[aria-selected="true"]').length, 1);
  assert.equal(listbox.querySelector('[aria-selected="true"]').dataset.value, '2');
  assert.equal(api.getCurrentIndex(), 20);
  assert.equal(api.isPlaying(), false);
  assert.deepEqual(app.errors, []);
});

test('select Escape and Tab close only the popup before its settings or archive owner', async (t) => {
  const app = await openApp(t, { width: 375 });
  const settingsTrigger = app.$('#settings-btn');
  settingsTrigger.focus();
  settingsTrigger.click();
  await until(() => app.$('#settings-panel').contains(app.document.activeElement), 'settings entry for nested menu');
  const skin = openSelect(app, 'skin-select');
  app.key(skin.trigger, 'Home');
  app.key(skin.trigger, 'Escape');
  assert.equal(skin.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(skin.select.value, 'paper', 'Escape cancels the pending skin');
  assert.ok(app.$('#settings-panel').classList.contains('visible'));
  assert.equal(app.document.activeElement, skin.trigger);
  openSelect(app, 'skin-select');
  const tabAllowed = app.key(skin.trigger, 'Tab');
  assert.equal(tabAllowed, true, 'Tab keeps native focus traversal available');
  assert.equal(skin.trigger.getAttribute('aria-expanded'), 'false');
  assert.ok(app.$('#settings-panel').classList.contains('visible'));
  app.key(skin.trigger, 'Escape');
  await until(() => app.document.activeElement === settingsTrigger, 'nested settings dismissal restores opener');

  const archiveTrigger = app.$('#journey-toggle');
  archiveTrigger.focus();
  archiveTrigger.click();
  const period = openSelect(app, 'period-select');
  app.key(period.trigger, 'End');
  app.key(period.trigger, 'Escape');
  assert.equal(period.select.value, 'all');
  assert.equal(period.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(archiveTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(app.document.activeElement, period.trigger);
  app.key(period.trigger, 'Escape');
  assert.equal(archiveTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.activeElement, archiveTrigger);
  assert.deepEqual(app.errors, []);
});

test('the period menu filters real records and synchronizes its selected state after reset', async (t) => {
  const app = await openApp(t);
  setViewMode(app, 'browse');
  const api = app.window.JourneyMap;
  api.goTo(20);
  const { select, trigger, listbox } = chooseSelect(app, 'period-select', 'yanan');
  const expected = api.getEvents().flatMap((event, index) => {
    const year = Number.parseInt(event.date, 10);
    return year >= 1937 && year <= 1948 ? [index] : [];
  });
  assert.deepEqual(app.$$('#journey-list .journey-item').map((item) => Number(item.dataset.index)), plain(expected));
  assert.equal(api.getCurrentIndex(), expected[0]);
  assert.ok(trigger.textContent.includes(select.selectedOptions[0].textContent));
  assert.equal(listbox.querySelector('[aria-selected="true"]').dataset.value, 'yanan');
  app.$('#reset-filters').click();
  await until(() => app.$$('#journey-list .journey-item').length === 109, 'period menu reset');
  assert.equal(select.value, 'all');
  assert.ok(trigger.textContent.includes(select.selectedOptions[0].textContent));
  assert.equal(listbox.querySelector('[aria-selected="true"]').dataset.value, 'all');
  assert.deepEqual(app.errors, []);
});

test('select controls synchronize programmatic values, disabled state, options and Chinese locale refresh', async (t) => {
  const app = await openApp(t);
  const controls = app.window.JourneyControls;
  const { select, trigger, listbox } = selectControls(app, 'playback-speed');
  const changes = [];
  select.addEventListener('change', () => changes.push(select.value));
  select.value = '3';
  controls.sync(select);
  assert.ok(trigger.textContent.includes(select.selectedOptions[0].textContent));
  assert.equal(listbox.querySelector('[aria-selected="true"]').dataset.value, '3');
  assert.deepEqual(changes, [], 'display synchronization does not synthesize business changes');
  select.value = '1';
  select.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  assert.ok(trigger.textContent.includes(select.selectedOptions[0].textContent));
  assert.deepEqual(changes, ['1']);

  openSelect(app, 'playback-speed');
  select.disabled = true;
  controls.sync('playback-speed');
  assert.equal(trigger.disabled, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  select.disabled = false;
  controls.sync();
  assert.equal(trigger.disabled, false);
  app.evaluate('applySpeedPreset(2)');
  assert.equal(select.value, '2');
  assert.ok(trigger.textContent.includes(select.selectedOptions[0].textContent), 'programmatic playback presets refresh the visible control');
  assert.equal(listbox.querySelector('[aria-selected="true"]').dataset.value, '2');
  assert.deepEqual(changes, ['1']);

  [...select.options].find((option) => option.value === '3').remove();
  select.append(new app.window.Option('缓行（重建选项）', '3'));
  controls.sync(select);
  chooseSelect(app, 'playback-speed', '3');
  assert.deepEqual(changes, ['1', '3']);
  assert.equal(listbox.querySelectorAll('[data-value="3"]').length, 1);
  assert.equal(app.$$('#playback-speed-trigger').length, 1);
  assert.equal(app.$$('#playback-speed-listbox').length, 1);
  select.value = '1';
  controls.sync(select);
  app.evaluate("i18n.translations.get('zh-CN').ui.controls.speedOptions.fast = '快速（文案更新）'; i18n.updateDOM();");
  await until(() => trigger.textContent.includes('快速（文案更新）'), 'Chinese select translation refresh');
  assert.equal(app.document.documentElement.lang, 'zh-CN');
  assert.ok(listbox.querySelector('[data-value="1"]').textContent.includes('快速（文案更新）'));
  assert.equal(listbox.querySelectorAll('[aria-selected="true"]').length, 1);
  assert.deepEqual(changes, ['1', '3']);
  assert.deepEqual(app.errors, []);
});

test('floating select menus escape the playback dock and close on outside action, resize and owner dismissal', async (t) => {
  const app = await openApp(t, {
    rects: { 'playback-speed-trigger': { left: 1000, top: 700, width: 100, height: 44 } },
  });
  const speed = openSelect(app, 'playback-speed');
  assert.equal(speed.listbox.parentElement, app.document.body);
  assert.equal(speed.listbox.closest('#playback-dock'), null);
  assert.ok(Number.parseFloat(speed.listbox.style.top) < 700, 'the speed popup is positioned above its trigger');
  app.pointer(app.document.body, 'pointerdown');
  app.document.body.click();
  assert.equal(speed.trigger.getAttribute('aria-expanded'), 'false');
  openSelect(app, 'playback-speed');
  app.setWidth(1100);
  assert.equal(speed.trigger.getAttribute('aria-expanded'), 'false');
  openSelect(app, 'playback-speed');
  speed.listbox.dispatchEvent(new app.window.Event('scroll', { bubbles: true }));
  assert.equal(speed.trigger.getAttribute('aria-expanded'), 'true', 'scrolling the menu keeps its choices available');
  app.window.dispatchEvent(new app.window.Event('scroll'));
  assert.equal(speed.trigger.getAttribute('aria-expanded'), 'false');

  app.$('#settings-btn').focus();
  app.$('#settings-btn').click();
  await until(() => app.$('#settings-panel').contains(app.document.activeElement), 'settings before menu owner dismissal');
  const skin = openSelect(app, 'skin-select');
  app.$('#settings-panel-close').click();
  await until(() => !app.$('#settings-panel').classList.contains('visible') && skin.trigger.getAttribute('aria-expanded') === 'false', 'closing settings also closes its portal menu');
  assert.equal(skin.listbox.getClientRects().length, 0);
  assert.equal(app.document.activeElement, app.$('#settings-btn'));
  openSelect(app, 'playback-speed');
  app.window.JourneyControls.close();
  assert.equal(speed.trigger.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(app.errors, []);
});

test('narrow speed triggers size menus for complete labels, viewport edges and border-inclusive content height', async (t) => {
  const app = await openApp(t, { width: 320 });
  const { listbox } = selectControls(app, 'playback-speed');
  let completeLabelWidth = 92;
  // Layout measurements are controlled inputs to positioning, not rendered pixels.
  const rectangle = (width, height) => ({ left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, width, height });
  Object.defineProperty(listbox, 'scrollHeight', { configurable: true, get: () => 170 });
  listbox.style.border = '1px solid rgb(0, 0, 0)';
  for (const option of listbox.querySelectorAll('.select-option')) {
    const label = option.querySelector('.select-option-label');
    assert.ok(label);
    option.getBoundingClientRect = () => rectangle(72, 40);
    label.getBoundingClientRect = () => rectangle(20, 20);
    Object.defineProperty(label, 'scrollWidth', { configurable: true, get: () => completeLabelWidth });
  }
  for (const triggerWidth of [58, 64, 82]) {
    app.setRect('playback-speed-trigger', { left: 312 - triggerWidth, top: 700, width: triggerWidth, height: 44 });
    app.setRect('playback-speed-listbox', { left: 0, top: 0, width: triggerWidth, height: 170 });
    openSelect(app, 'playback-speed');
    const width = Number.parseFloat(listbox.style.width);
    const left = Number.parseFloat(listbox.style.left);
    assert.ok(width >= 144, `${triggerWidth}px trigger leaves room for the complete label and option decoration`);
    assert.ok(left >= 8 && left + width <= 312, 'the menu stays within the narrow viewport');
    assert.equal(Number.parseFloat(listbox.style.maxHeight), 172, 'fitting 170px content includes both 1px borders');
    assert.ok(Number.parseFloat(listbox.style.top) + 172 < 700);
    app.window.JourneyControls.close();
  }
  completeLabelWidth = 600;
  openSelect(app, 'playback-speed');
  assert.equal(Number.parseFloat(listbox.style.width), 304, 'oversized content is constrained to available viewport width');
  assert.equal(Number.parseFloat(listbox.style.left), 8);
  app.window.JourneyControls.close();
  assert.deepEqual(app.errors, []);
});

test('range progress stays synchronized for programmatic navigation, preview cancellation and settings input', async (t) => {
  const app = await openApp(t);
  const api = app.window.JourneyMap;
  const timeline = app.$('#timeline-slider');
  const progress = (element) => Number.parseFloat(element.style.getPropertyValue('--range-progress'));
  api.goTo(54);
  assert.equal(progress(timeline), 50);
  app.pointer(timeline, 'pointerdown');
  app.input(timeline, '81');
  assert.equal(progress(timeline), 75);
  assert.equal(api.getCurrentIndex(), 54);
  app.pointer(timeline, 'pointercancel');
  assert.equal(progress(timeline), 50);
  for (const [id, value, expected] of [
    ['follow-zoom-slider', '8', 60],
    ['path-speed-multiplier', '4', 75],
    ['music-volume-slider', '25', 25],
  ]) {
    const range = app.$(`#${id}`);
    app.input(range, value);
    assert.equal(progress(range), expected);
  }
  setSkin(app, 'classic');
  assert.equal(progress(timeline), 50, 'skin changes retain the actual slider progress');
  assert.equal(api.getCurrentIndex(), 54);
  assert.deepEqual(app.errors, []);
});

test('public events are immutable and event navigation synchronizes the map and detail', async (t) => {
  const app = await openApp(t);
  const api = app.window.JourneyMap;
  const events = api.getEvents();
  assert.ok(Object.isFrozen(events));
  assert.ok(Object.isFrozen(events[2]));
  assert.ok(Object.isFrozen(events[2].coordinates));
  assert.equal(new Set(events.map((event) => event.id)).size, 109);
  const changes = [];
  app.document.addEventListener('journey:event-change', (event) => changes.push(event.detail));
  assert.equal(api.goTo(63), true);
  assert.equal(api.getCurrentIndex(), 63);
  assert.equal(changes.at(-1).index, 63);
  assert.equal(changes.at(-1).event.id, events[63].id);
  assert.equal(app.$('#event-title').textContent, events[63].event);
  assert.equal(app.$('#event-date').textContent, events[63].date);
  assert.equal(app.$('#timeline-slider').value, '63');
  assert.equal(api.goTo(-1), false);
  assert.equal(api.goTo(109), false);
  assert.equal(api.goTo(2.5), false);
  assert.equal(api.goTo('not-an-index'), false);
  assert.equal(api.getCurrentIndex(), 63);
  assert.deepEqual(app.errors, []);
});

test('GitHub Pages project subpaths load scripts, styles and fetched JSON as static relative resources', async (t) => {
  const baseURL = 'https://example.github.io/mao-map/';
  const app = await openApp(t, { baseURL });
  assert.equal(app.window.JourneyMap.getEvents().length, 109);
  assert.ok(app.requests.includes('i18n/zh-CN.json'));
  assert.ok(app.requests.includes('data/china_regions_coordinates.json'));
  assert.ok(app.requests.includes('data/mao_trajectory_events.json'));
  for (const url of app.requestURLs) assert.ok(url.startsWith(baseURL), url);
  for (const resource of app.$$('script[src], link[rel="stylesheet"][href], img[src]')) {
    const source = resource.getAttribute('src') || resource.getAttribute('href');
    if (/^data:|^blob:/.test(source)) continue;
    const resolved = new URL(source, app.window.location.href);
    assert.ok(resolved.href.startsWith(baseURL), `${source} must stay inside the deployed project`);
    await access(path.join(projectRoot, decodeURIComponent(resolved.pathname.slice('/mao-map/'.length))));
  }
  assert.deepEqual(app.errors, []);
});

test('route scope uses actual event coordinates and does not invent travel for local activity', async (t) => {
  const app = await openApp(t);
  const api = app.window.JourneyMap;
  assert.equal(api.setRouteScope('current'), true);
  api.goTo(1);
  assert.equal(app.evaluate('pathLayers.length'), 0);
  assert.ok(app.evaluate('locationMarkers.size') > 0);

  api.goTo(2);
  const route = plain(app.evaluate('pathLayers.map((layer) => ({ index: layer._eventIndex, points: layer._originalPathCoords }))'));
  assert.equal(route.length, 1);
  assert.equal(route[0].index, 2);
  assert.ok(app.evaluate('pathLayers[0].getLatLngs().length') > 1, 'static Leaflet motion paths must actually contain visible geometry');
  const current = api.getEvents()[2];
  assert.deepEqual(route[0].points, plain([current.startCoords, ...current.transitCoords, current.endCoords].map(([lng, lat]) => [lat, lng])));

  api.goTo(60);
  assert.equal(app.evaluate('pathLayers.every((layer) => layer._eventIndex === 60)'), true);
  assert.equal(api.setRouteScope('all'), true);
  assert.ok(app.evaluate('pathLayers.length') > 1);
  assert.equal(app.evaluate('pathLayers.every((layer) => layer._eventIndex <= 60 && !layer._isConnectionPath)'), true);
  assert.equal(api.setRouteScope('invalid'), false);
  assert.deepEqual(app.errors, []);
});

test('first and last events have correct disabled navigation boundaries', async (t) => {
  const app = await openApp(t);
  const api = app.window.JourneyMap;
  assert.equal(app.$('#prev-btn').disabled, true);
  app.$('#prev-btn').click();
  assert.equal(api.getCurrentIndex(), 0);
  api.goTo(108);
  assert.equal(app.$('#next-btn').disabled, true);
  app.$('#next-btn').click();
  assert.equal(api.getCurrentIndex(), 108);
  assert.match(app.$('#timeline-slider').getAttribute('aria-valuetext'), /1976/);
  app.key(app.document.body, 'Home');
  assert.equal(api.getCurrentIndex(), 0);
  app.key(app.document.body, 'End');
  assert.equal(api.getCurrentIndex(), 108);
  assert.deepEqual(app.errors, []);
});

test('pointer range previews are committed on release and canceled safely', async (t) => {
  const app = await openApp(t, { width: 375 });
  const api = app.window.JourneyMap;
  const slider = app.$('#timeline-slider');
  const events = api.getEvents();
  const assertCard = (index) => {
    assert.equal(app.$('#event-title').textContent, events[index].event);
    assert.equal(app.$('#event-type').textContent, events[index].movementType);
    if (events[index].verification) assert.equal(app.$('#event-verification').textContent, events[index].verification);
    assert.equal(app.$('#current-age-desktop').textContent, String(events[index].age));
    assert.equal(app.$('#current-event-index-desktop').textContent, String(index + 1));
    assert.equal(app.$('#current-progress-desktop').textContent, `${((index + 1) / events.length * 100).toFixed(1)}%`);
    assert.equal(slider.style.getPropertyValue('--timeline-progress'), `${index / (events.length - 1) * 100}%`);
    const coordinates = events[index].coordinates;
    const stops = [coordinates.start, ...(coordinates.transit || []), coordinates.end]
      .filter(Boolean).map((place) => place.district || place.city || place.province || place.country)
      .filter((place, position, places) => position === 0 || place !== places[position - 1]);
    if (stops.length > 1) assert.deepEqual(app.$$('#event-route .route-stop').map((element) => element.textContent), plain(stops));
    else assert.ok(app.$('#event-route .stationary-note'));
  };
  api.goTo(4);
  app.pointer(slider, 'pointerdown');
  app.input(slider, '51');
  assert.equal(api.getCurrentIndex(), 4, 'preview must keep the committed event');
  assert.equal(app.$('#journey-list [aria-current="step"]').dataset.index, '4');
  assertCard(51);
  app.pointer(slider, 'pointerup');
  assert.equal(api.getCurrentIndex(), 51);
  assertCard(51);

  app.pointer(slider, 'pointerdown');
  app.input(slider, '67');
  assertCard(67);
  app.pointer(slider, 'pointercancel');
  assert.equal(api.getCurrentIndex(), 51);
  assert.equal(slider.value, '51');
  assertCard(51);

  app.pointer(slider, 'pointerdown');
  app.input(slider, '64');
  slider.dispatchEvent(new app.window.Event('blur'));
  assert.equal(api.getCurrentIndex(), 51);
  assert.equal(slider.value, '51');
  assertCard(51);
  assert.deepEqual(app.errors, []);
});

test('playback reaches the final record, offers replay and stops when an event is selected', async (t) => {
  const app = await openApp(t);
  const api = app.window.JourneyMap;
  api.goTo(107);
  const speed = app.$('#playback-speed');
  speed.value = '0';
  speed.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  app.$('#play-btn').click();
  assert.equal(api.isPlaying(), true);
  await until(() => api.getCurrentIndex() === 108, 'playback completion');
  assert.equal(api.isPlaying(), false);
  assert.match(app.$('#play-btn').getAttribute('aria-label'), /重播/);
  app.$('#play-btn').click();
  assert.equal(api.getCurrentIndex(), 0);
  assert.equal(api.isPlaying(), true);
  api.goTo(15);
  assert.equal(api.isPlaying(), false);
  assert.equal(app.evaluate('playInterval'), null);
  assert.equal(api.getCurrentIndex(), 15);
  assert.deepEqual(app.errors, []);
});

test('rapid navigation cancels normal motion without stale paths or delayed event changes', async (t) => {
  const app = await openApp(t, { reducedMotion: false });
  const api = app.window.JourneyMap;
  app.input(app.$('#path-speed-multiplier'), '1');
  const speed = app.$('#playback-speed');
  speed.value = '0';
  speed.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  api.setRouteScope('current');
  api.goTo(2);
  app.$('#next-btn').click();
  app.$('#next-btn').click();
  app.$('#prev-btn').click();
  api.goTo(2);
  await new Promise((resolve) => setTimeout(resolve, 850));
  assert.equal(api.getCurrentIndex(), 2);
  assert.equal(api.isPlaying(), false);
  assert.equal(app.evaluate('pathLayers.length'), 1);
  assert.equal(app.evaluate('pathLayers[0]._eventIndex'), 2);
  assert.ok(app.evaluate('pathLayers[0].getLatLngs().length') > 1);
  assert.equal(app.$('#event-title').textContent, api.getEvents()[2].event);
  assert.deepEqual(app.errors, []);
});

test('localized data preserves all Chinese event identities and geographic coordinates', async (t) => {
  const app = await openApp(t);
  const initialTitle = app.document.title;
  const initialHTMLLanguage = app.document.documentElement.lang;
  const chinese = app.window.JourneyMap.getEvents();
  const englishSource = await readProjectJSON('data/mao_trajectory_events_en.json');
  assert.equal(englishSource.events.length, 108);
  // Exercise only the data loader: no setLocale, language click, DOM translation
  // or English interface inspection is performed.
  const localized = await app.evaluate("loadTrajectoryData('en')");
  assert.equal(localized.events.length, 109);
  assert.deepEqual(plain(localized.events.map((event) => event.id)), plain(chinese.map((event) => event.id)));
  for (let index = 0; index < chinese.length; index += 1) {
    assert.equal(localized.events[index].date, chinese[index].date);
    assert.deepEqual(plain(localized.events[index].startCoords), plain(chinese[index].startCoords));
    assert.deepEqual(plain(localized.events[index].endCoords), plain(chinese[index].endCoords));
    const translation = englishSource.events.find((event) => event.date === chinese[index].date);
    if (translation) assert.equal(localized.events[index].event, translation.event);
  }
  const missing = localized.events.find((event) => event.date === '1958-09');
  assert.ok(missing.event.length > 0);
  assert.equal(missing.id, chinese.find((event) => event.date === missing.date).id);
  assert.equal(app.document.documentElement.lang, initialHTMLLanguage);
  assert.equal(app.document.title, initialTitle);
});

test('tile failures leave the timeline usable and expose a working retry', async (t) => {
  const app = await openApp(t);
  const tileLayer = app.tileLayers[0];
  tileLayer.fire('loading');
  tileLayer.fire('tileerror');
  tileLayer.fire('load');
  const status = app.$('#map-status');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /底图/);
  app.window.JourneyMap.goTo(6);
  assert.equal(app.window.JourneyMap.getCurrentIndex(), 6);
  const retry = status.querySelector('button');
  assert.ok(retry);
  retry.click();
  tileLayer.fire('loading');
  tileLayer.fire('load');
  assert.equal(status.hidden, true);
});

test('minimum map zoom keeps the base layer active through zoom controls and fit operations', async (t) => {
  const app = await openApp(t);
  const map = app.evaluate('map');
  const tileLayer = app.tileLayers[0];
  const zoomIn = app.$('#zoom-in');
  const zoomOut = app.$('#zoom-out');
  assert.equal(zoomIn.tagName, 'BUTTON');
  assert.equal(zoomOut.tagName, 'BUTTON');
  assert.match(zoomIn.getAttribute('aria-label'), /放大/);
  assert.match(zoomOut.getAttribute('aria-label'), /缩小/);
  assert.equal(map.getMinZoom(), 4);
  assert.equal(tileLayer.options.minZoom, map.getMinZoom());
  map.setZoom(5, { animate: false });
  zoomOut.click();
  assert.equal(map.getZoom(), 4, 'the visible zoom-out button controls the real map');
  assert.equal(zoomOut.disabled, true);
  assert.equal(zoomOut.getAttribute('aria-disabled'), 'true');
  zoomOut.click();
  assert.equal(map.getZoom(), 4);
  zoomIn.click();
  assert.equal(map.getZoom(), 5);
  assert.equal(zoomOut.disabled, false);
  assert.equal(zoomOut.getAttribute('aria-disabled'), 'false');
  zoomIn.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert.equal(map.getZoom(), 8, 'Shift-click retains the larger zoom step');
  zoomOut.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  assert.equal(map.getZoom(), 5);
  map.setZoom(map.getMaxZoom() - 1, { animate: false });
  zoomIn.click();
  assert.equal(map.getZoom(), map.getMaxZoom());
  assert.equal(zoomIn.disabled, true);
  assert.equal(zoomIn.getAttribute('aria-disabled'), 'true');
  zoomIn.click();
  assert.equal(map.getZoom(), map.getMaxZoom());
  zoomOut.click();
  assert.equal(zoomIn.disabled, false);
  assert.equal(zoomIn.getAttribute('aria-disabled'), 'false');
  for (let step = 0; step < 5; step += 1) map.zoomOut(1, { animate: false });
  assert.equal(map.getZoom(), 4);
  map.setZoom(2, { animate: false });
  assert.equal(map.getZoom(), 4, 'programmatic zoom cannot request unsupported low-detail tiles');
  map.fitBounds([[-60, -120], [70, 160]], { animate: false });
  assert.equal(map.getZoom(), 4, 'fitting broad bounds respects the same base-map lower limit');
  app.window.JourneyMap.goTo(108);
  app.window.JourneyMap.fitJourney();
  assert.ok(map.getZoom() >= 4);
  map.setZoom(2, { animate: false });
  await until(() => Object.values(tileLayer._tiles).some((tile) => tile.coords.z === 4 && tile.el.isConnected), 'connected base-map tiles at minimum zoom');
  assert.equal(map.hasLayer(tileLayer), true);
  assert.equal(tileLayer._tileZoom, 4);
  assert.ok(Object.values(tileLayer._tiles).every((tile) => tile.coords.z >= 4));
  assert.equal(zoomOut.disabled, true);
  assert.equal(zoomOut.getAttribute('aria-disabled'), 'true');
  map.setZoom(5, { animate: false });
  assert.equal(zoomOut.disabled, false);
  assert.equal(zoomOut.getAttribute('aria-disabled'), 'false');
  assert.equal(app.window.JourneyMap.getCurrentIndex(), 108);
  assert.deepEqual(app.errors, []);
});

test('trajectory loading failure provides a visible retry without a half-ready API', async (t) => {
  const app = await openApp(t, {
    waitForReady: false,
    fetchOverrides: { 'data/mao_trajectory_events.json': new Error('Fixture: failed trajectory load') },
  });
  await until(() => app.$('#loading [role="alert"]'), 'trajectory error feedback');
  assert.equal(app.window.JourneyMap.getEvents().length, 0);
  assert.ok(app.$('#loading button'), 'failed initialization must offer retry');
  assert.notEqual(app.$('#loading').style.display, 'none');
});

test('opening the compact archive after loading failure focuses an available control', async (t) => {
  const app = await openApp(t, {
    width: 375,
    waitForReady: false,
    fetchOverrides: { 'data/mao_trajectory_events.json': new Error('Fixture: unavailable records') },
  });
  await until(() => app.$('#loading [role="alert"]'), 'failed data state');
  assert.equal(app.$('#journey-search').disabled, true);
  assert.equal(app.$('#period-select-trigger').disabled, true);
  const trigger = app.$('#journey-toggle');
  trigger.focus();
  trigger.click();
  const active = app.document.activeElement;
  assert.ok(app.$('#journey-sidebar').contains(active));
  assert.notEqual(active.disabled, true);
  assert.equal(active.closest('[inert]'), null);
  app.key(active, 'Escape');
  assert.equal(app.document.activeElement, trigger);
});

test('resizing a failed compact browse archive to desktop keeps focus on its enabled close control', async (t) => {
  const app = await openApp(t, {
    width: 375,
    storage: { 'mao-map:view-mode': 'browse' },
    waitForReady: false,
    fetchOverrides: { 'data/mao_trajectory_events.json': new Error('Fixture: unavailable records') },
  });
  await until(() => app.$('#loading [role="alert"]'), 'failed compact browse data state');
  const errorCount = app.errors.length;
  const sidebar = app.$('#journey-sidebar');
  const close = app.$('#journey-close');
  app.$('#journey-toggle').focus();
  app.$('#journey-toggle').click();
  assert.equal(app.$('#journey-search').disabled, true);
  assert.equal(app.document.activeElement, close);
  app.setWidth(1440);
  assert.equal(app.document.body.classList.contains('compact'), false);
  assert.equal(sidebar.inert, false);
  assert.equal(sidebar.hasAttribute('aria-modal'), false);
  assert.equal(app.document.activeElement, close);
  assert.equal(close.disabled, false);
  assert.equal(close.closest('[hidden], [inert]'), null);
  assert.equal(app.errors.length, errorCount, 'resizing adds no errors beyond the intentional load failure');
});

test('resizing open compact settings keeps language-control focus inside the active dialog', async (t) => {
  for (const [mode, viewport] of [
    ['playback', { width: 375, height: 900 }],
    ['browse', { width: 1440, height: 560 }],
  ]) {
    const app = await openApp(t, { ...viewport, storage: { 'mao-map:view-mode': mode } });
    const trigger = app.$('#settings-btn');
    const settings = app.$('#settings-panel');
    const language = app.$('#language-selector .lang-btn[data-lang="zh-CN"]');
    trigger.focus();
    trigger.click();
    await until(() => settings.contains(app.document.activeElement), `${mode} compact settings focus`);
    assert.ok(language.closest('#settings-panel'));
    language.focus();
    assert.equal(app.document.activeElement, language);
    app.setViewport({ width: 1440, height: 900 });
    assert.ok(language.closest('.app-header'), 'the language control returns to the desktop header');
    assert.equal(app.$('.app-header').inert, true);
    assert.equal(app.document.activeElement, app.$('#settings-panel-close'));
    assert.equal(app.document.activeElement.closest('[hidden], [inert]'), null);
    assert.equal(app.document.body.dataset.viewMode, mode);
    app.key(app.document.activeElement, 'Escape');
    await until(() => app.document.activeElement === trigger, `${mode} resized settings focus return`);
    assert.equal(trigger.closest('[hidden], [inert]'), null);
    assert.deepEqual(app.errors, []);
  }
});

test('compact breakpoints move focus out of the now-inert desktop archive', async (t) => {
  const app = await openApp(t, { width: 1440 });
  setViewMode(app, 'browse');
  const list = app.$('#journey-list');
  list.focus();
  app.setWidth(900);
  assert.equal(app.$('#journey-sidebar').inert, true);
  assert.equal(app.document.activeElement, app.$('#journey-toggle'));
  assert.equal(app.document.activeElement.closest('[inert]'), null);
  assert.equal(app.$('#journey-toggle').getAttribute('aria-label'), '足迹年表');
  app.setViewport({ width: 1440, height: 900 });
  list.focus();
  app.setViewport({ height: 560 });
  assert.ok(app.document.body.classList.contains('compact'));
  assert.equal(app.$('#journey-sidebar').inert, true);
  assert.equal(app.document.activeElement, app.$('#journey-toggle'));
  assert.equal(app.document.activeElement.closest('[inert]'), null);
  assert.deepEqual(app.errors, []);
});

test('partial geographic data and long event text remain readable as text', async (t) => {
  const data = await readProjectJSON('data/mao_trajectory_events.json');
  const fixture = { ...data, events: data.events.slice(0, 2) };
  fixture.events[0].event = `${'历史活动记录，'.repeat(80)}<img id="injected-event" src="bad" onerror="alert(1)">`;
  fixture.events[0].coordinates = { end: { province: '测试未知地域' } };
  const app = await openApp(t, {
    fetchOverrides: { 'data/mao_trajectory_events.json': fixture },
  });
  assert.equal(app.window.JourneyMap.getEvents().length, 2);
  assert.equal(app.$('#event-title').textContent, fixture.events[0].event);
  assert.equal(app.$('#injected-event'), null);
  assert.equal(app.evaluate('pathLayers.length'), 0);
  app.window.JourneyMap.goTo(1);
  assert.equal(app.$('#event-title').textContent, fixture.events[1].event);
  assert.equal(app.window.JourneyMap.getCurrentIndex(), 1);
  assert.deepEqual(app.errors, []);
});

test('the timeline searches real Chinese records, handles empty results and resets filters', async (t) => {
  const app = await openApp(t);
  setViewMode(app, 'browse');
  const search = app.$('#journey-search');
  const list = app.$('#journey-list');
  const buttons = () => [...list.querySelectorAll('button')];
  await until(() => buttons().length === 109, 'the complete timeline');
  app.input(search, '延安');
  await until(() => buttons().length > 0 && buttons().length < 109, 'Chinese place search');
  assert.equal(app.$('#journey-empty').hidden, true);
  const source = await readProjectJSON('data/mao_trajectory_events.json');
  const expected = source.events.flatMap((event, index) =>
    `${event.event} ${JSON.stringify(event.coordinates)}`.includes('延安') ? [index] : []);
  assert.deepEqual(buttons().map((button) => Number(button.dataset.index)), expected);
  app.input(search, '无此地点-999999');
  await until(() => !app.$('#journey-empty').hidden, 'empty search feedback');
  assert.equal(buttons().length, 0);
  app.$('#reset-filters').click();
  await until(() => buttons().length === 109, 'reset filters');
  assert.equal(search.value, '');
  assert.equal(app.$('#period-select').value, 'all');
  assert.equal(app.$('#journey-empty').hidden, true);

  const period = app.$('#period-select');
  assert.ok(period.options.length >= 4, 'periods must provide meaningful chapters');
  period.value = [...period.options].find((option) => option.value !== 'all').value;
  period.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  await until(() => buttons().length > 0 && buttons().length < 109, 'historical period filter');
  app.$('#reset-filters').click();
  await until(() => buttons().length === 109, 'period reset');
  assert.deepEqual(app.errors, []);
});

test('selecting an archive record updates current details and find-current reveals it again', async (t) => {
  const app = await openApp(t);
  setViewMode(app, 'browse');
  const events = app.window.JourneyMap.getEvents();
  await until(() => app.$$('#journey-list button').length === 109, 'archive records');
  const target = app.$$('#journey-list button').find((button) => button.textContent.includes(events[75].event));
  assert.ok(target);
  target.focus();
  target.click();
  assert.equal(app.window.JourneyMap.getCurrentIndex(), 75);
  assert.equal(app.$('#event-title').textContent, events[75].event);
  assert.ok(app.$('#journey-list [aria-current="true"], #journey-list [aria-current="step"]'));
  app.input(app.$('#journey-search'), '无此地点-999999');
  await until(() => !app.$('#journey-empty').hidden, 'current event excluded by filter');
  app.$('#find-current').click();
  await until(() => app.$$('#journey-list button').length === 109, 'find current clearing filters');
  const selected = app.$('#journey-list [aria-current="true"], #journey-list [aria-current="step"]');
  assert.ok(selected.textContent.includes(events[75].event));
  app.$('#read-event').click();
  assert.equal(app.$('#event-source').open, true);
  app.$('#read-event').click();
  assert.equal(app.$('#event-source').open, false);
  assert.deepEqual(app.errors, []);
});

test('dialogs isolate timeline keys, trap focus and return focus to the opener', async (t) => {
  const app = await openApp(t);
  for (const [triggerId, dialogId, closeId] of [
    ['music-btn', 'music-modal', 'music-modal-close'],
    ['feedback-btn', 'feedback-modal', 'feedback-modal-close'],
    ['settings-btn', 'settings-panel', 'settings-panel-close'],
  ]) {
    const trigger = app.$(`#${triggerId}`);
    const dialog = app.$(`#${dialogId}`);
    trigger.focus();
    trigger.click();
    await until(() => dialog.classList.contains('visible') && dialog.contains(app.document.activeElement), `${dialogId} focus entry`);
    assert.equal(dialog.inert, false);
    if (dialogId === 'settings-panel') {
      for (const zoom of [app.$('#zoom-in'), app.$('#zoom-out')]) {
        assert.ok(zoom.closest('[inert]'), 'settings make the background map controls inert');
        assert.equal(zoom.getClientRects().length, 0);
      }
    }
    const originalIndex = app.window.JourneyMap.getCurrentIndex();
    app.key(app.document.activeElement, 'ArrowRight');
    app.key(app.document.activeElement, 'End');
    app.key(app.document.activeElement, ' ');
    assert.equal(app.window.JourneyMap.getCurrentIndex(), originalIndex);
    assert.equal(app.window.JourneyMap.isPlaying(), false);
    const candidates = [...dialog.querySelectorAll('button, input, select, a[href], summary, [tabindex="0"]')].filter((element) => !element.disabled && element.getClientRects().length);
    assert.ok(candidates.length > 1);
    candidates.at(-1).focus();
    app.key(candidates.at(-1), 'Tab');
    assert.equal(app.document.activeElement, candidates[0]);
    app.key(candidates[0], 'Tab', { shiftKey: true });
    assert.equal(app.document.activeElement, candidates.at(-1));
    app.$(`#${closeId}`).click();
    await until(() => !dialog.classList.contains('visible') && app.document.activeElement === trigger, `${dialogId} focus restoration`);
    assert.equal(dialog.inert, true);
    if (dialogId === 'settings-panel') {
      assert.equal(app.$('#zoom-in').closest('[inert]'), null);
      assert.ok(app.$('#zoom-in').getClientRects().length);
    }
  }
  assert.deepEqual(app.errors, []);
});

test('timeline shortcuts do not steal typing or visible select trigger keys', async (t) => {
  const app = await openApp(t);
  setViewMode(app, 'browse');
  const search = app.$('#journey-search');
  search.focus();
  for (const key of ['ArrowRight', 'End', ' ']) app.key(search, key);
  assert.equal(app.window.JourneyMap.getCurrentIndex(), 0);
  assert.equal(app.window.JourneyMap.isPlaying(), false);
  for (const control of [app.$('#period-select-trigger'), app.$('#playback-speed-trigger')]) {
    control.focus();
    app.key(control, 'ArrowRight');
    app.key(control, 'ArrowLeft');
    app.key(control, ' ');
    app.key(control, 'End');
    assert.equal(app.window.JourneyMap.getCurrentIndex(), 0);
    assert.equal(app.window.JourneyMap.isPlaying(), false);
    app.window.JourneyControls.close();
  }
  assert.deepEqual(app.errors, []);
});

test('a Leaflet location opens its archive with isolated keys and restores marker focus', async (t) => {
  const app = await openApp(t);
  const marker = app.$('#map .leaflet-marker-icon');
  assert.ok(marker);
  marker.focus();
  app.evaluate('locationMarkers.values().next().value.fire("click")');
  const panel = app.$('#location-detail-panel');
  await until(() => panel.classList.contains('visible') && panel.contains(app.document.activeElement), 'location archive focus');
  panel.focus();
  app.key(panel, 'ArrowRight');
  app.key(panel, 'End');
  assert.equal(app.window.JourneyMap.getCurrentIndex(), 0);
  assert.ok(panel.querySelector('button.event-select'), 'location archive exposes real event navigation');
  app.$('#panel-close-btn').click();
  await until(() => !panel.classList.contains('visible') && app.document.activeElement === marker, 'marker focus restoration');
  assert.deepEqual(app.errors, []);
});

test('mobile and desktop media conditions keep archive access and selected event behavior available', async (t) => {
  for (const width of [320, 375, 800, 1440]) {
    const app = await openApp(t, { width });
    const sidebar = app.$('#journey-sidebar');
    const trigger = app.$('#journey-toggle');
    assert.equal(app.window.JourneyMap.getEvents().length, 109);
    assert.equal(trigger.getAttribute('aria-label'), '足迹年表');
    if (width <= 900) {
      trigger.focus();
      trigger.click();
      await until(() => trigger.getAttribute('aria-expanded') === 'true', `${width}px archive opening`);
      assert.equal(sidebar.inert, false);
      assert.equal(trigger.getAttribute('aria-label'), '足迹年表');
      const list = app.$('#journey-list');
      list.focus();
      app.key(list, 'ArrowRight');
      assert.equal(app.window.JourneyMap.getCurrentIndex(), 0, 'drawer keys must not change the background timeline');
      app.$('#journey-close').click();
      await until(() => trigger.getAttribute('aria-expanded') === 'false', `${width}px archive closing`);
      assert.equal(app.document.activeElement, trigger);
    }
    app.window.JourneyMap.goTo(20);
    assert.equal(app.$('#event-title').textContent, app.window.JourneyMap.getEvents()[20].event);
    assert.deepEqual(app.errors, [], `${width}px conditions have no runtime errors`);
  }
});

test('Tauri Android shares the compact archive and accessible settings even at a wide viewport', async (t) => {
  const app = await openApp(t, { entry: 'tauri.html', width: 1440, nativeAndroid: true });
  assert.ok(app.document.body.classList.contains('android'));
  assert.ok(app.document.body.classList.contains('compact'));
  assert.equal(app.$('#journey-toggle').hidden, true);
  assert.equal(app.$('#titlebar').hidden, true);
  assert.equal(app.$('#journey-sidebar').getAttribute('role'), 'dialog');
  assert.equal(app.$$('#language-selector').length, 1);
  assert.ok(app.$('#language-selector').closest('#settings-panel'));
  assert.ok(app.$('#check-update-btn').closest('.camera-settings'));

  const settingsTrigger = app.$('#settings-btn');
  settingsTrigger.focus();
  settingsTrigger.click();
  await until(() => app.$('#settings-panel').contains(app.document.activeElement), 'Android settings focus');
  app.key(app.document.activeElement, 'Escape');
  await until(() => app.document.activeElement === settingsTrigger, 'Android settings focus return');
  assert.equal(app.$('#settings-panel').inert, true);

  const archiveTrigger = app.$('#journey-toggle');
  assert.equal(archiveTrigger.hidden, true, 'closing settings keeps the playback map free of the archive entry');
  setViewMode(app, 'browse');
  assert.equal(archiveTrigger.hidden, false);
  archiveTrigger.focus();
  archiveTrigger.click();
  const record = app.$('#journey-list [data-index="20"]');
  record.focus();
  record.click();
  assert.equal(app.window.JourneyMap.getCurrentIndex(), 20);
  assert.equal(archiveTrigger.getAttribute('aria-expanded'), 'false');
  assert.equal(app.$('#journey-sidebar').inert, true);
  assert.equal(app.document.activeElement, archiveTrigger);
  app.setWidth(375);
  setViewMode(app, 'playback');
  assert.equal(archiveTrigger.hidden, true);
  setViewMode(app, 'browse');
  assert.equal(archiveTrigger.hidden, false);
  assert.deepEqual(app.errors, []);
});
