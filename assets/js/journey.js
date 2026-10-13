/* Timeline browsing, reading and shared accessible surfaces; map logic stays in app.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = (key, vars) => i18n.t(`journey.${key}`, vars);
  const periods = [
    { id: 'youth', start: 1893, end: 1917 },
    { id: 'awakening', start: 1918, end: 1926 },
    { id: 'revolution', start: 1927, end: 1933 },
    { id: 'march', start: 1934, end: 1936 },
    { id: 'yanan', start: 1937, end: 1948 },
    { id: 'nation', start: 1949, end: 1976 },
  ];
  const compactQuery = window.matchMedia('(max-width: 900px)');
  const shortQuery = window.matchMedia('(max-height: 560px)');
  const nativeAndroid = !!window.__TAURI_INTERNALS__ && /android/i.test(navigator.userAgent);
  let events = [];
  let currentIndex = 0;
  let isCompact = false;
  let activeOverlay = null;
  let returnFocus = null;
  let composing = false;
  let isPreviewing = false;
  let completionReached = false;
  let poetryPending = false;
  let poetryFrame = null;
  let poemIndex = -1;
  let poemOrder = [];
  const poetryDialog = $('poetry-modal');
  const poetryEntry = $('poetry-open');
  const sidebar = $('journey-sidebar');
  const archiveSummary = document.querySelector('.player-caption');
  const source = $('event-source');
  const eventCard = $('current-event-card');
  const dock = $('playback-dock');
  const mapTools = document.querySelector('.map-tools');
  const mapToolsToggle = $('map-tools-toggle');
  const mapToolsPanel = $('map-tool-panel');
  let mapToolsOpen = false;
  function preference(key, allowed, fallback) {
    try {
      const value = localStorage.getItem(`mao-map:${key}`);
      return allowed.includes(value) ? value : fallback;
    } catch { return fallback; }
  }
  function savePreference(key, value) {
    try { localStorage.setItem(`mao-map:${key}`, String(value)); } catch { /* Private browsing can disable storage. */ }
  }
  function numberPreference(key, min, max, fallback) {
    try {
      const saved = localStorage.getItem(`mao-map:${key}`);
      const value = saved?.trim() ? Number(saved) : NaN;
      return Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback;
    } catch { return fallback; }
  }
  let viewMode = preference('view-mode', ['playback', 'browse'], 'playback');
  let skin = preference('skin', ['classic', 'paper'], 'paper');
  let archiveCollapsed = preference('archive-collapsed', ['true', 'false'], 'false') === 'true';
  let eventCollapsed = preference('event-collapsed', ['true', 'false'], 'false') === 'true';
  let selectedPeriod = preference('period', ['all', ...periods.map(period => period.id)], 'all');
  const usesArchiveDrawer = () => isCompact || viewMode === 'playback';
  const archiveContainsFocus = () => sidebar.contains(document.activeElement) || archiveSummary.contains(document.activeElement);
  const periodOf = event => periods.find(period => Number.parseInt(event.date, 10) <= period.end) || periods.at(-1);
  const shortPlace = place => place && (place.district || place.city || place.province || place.country) || '';
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  function syncMapTools() {
    mapToolsToggle.hidden = !isCompact;
    mapToolsPanel.hidden = isCompact && !mapToolsOpen;
    mapTools.classList.toggle('is-open', mapToolsOpen);
    mapToolsToggle.setAttribute('aria-expanded', String(mapToolsOpen));
    const label = t(mapToolsOpen ? 'hideMapTools' : 'showMapTools');
    mapToolsToggle.title = label;
    mapToolsToggle.setAttribute('aria-label', label);
    if (mapToolsToggle.dataset.open !== String(mapToolsOpen)) {
      mapToolsToggle.innerHTML = window.JourneyIcons.svg(mapToolsOpen ? 'x' : 'map');
      mapToolsToggle.dataset.open = String(mapToolsOpen);
    }
    if (!isCompact) mapToolsPanel.removeAttribute('style');
  }

  function positionMapTools() {
    if (!mapToolsOpen) return;
    const anchor = mapToolsToggle.getBoundingClientRect();
    const mapRect = $('map-stage').getBoundingClientRect();
    const bounds = {
      left: Math.max(8, mapRect.left + 8),
      right: Math.min(window.innerWidth - 8, mapRect.right - 8),
      top: Math.max(8, mapRect.top + 8),
      bottom: Math.min(window.innerHeight - 8, mapRect.bottom - 8),
    };
    mapToolsPanel.style.maxWidth = `${Math.max(1, bounds.right - bounds.left)}px`;
    mapToolsPanel.style.maxHeight = `${Math.max(1, bounds.bottom - bounds.top)}px`;
    const { width, height } = mapToolsPanel.getBoundingClientRect();
    let left = anchor.right - width;
    let top = anchor.bottom + 8;
    // In a short map, open beside the trigger and scroll the contents only.
    if (top + height > bounds.bottom) {
      left = anchor.left - width - 8;
      top = anchor.top;
      if (left < bounds.left) {
        left = anchor.right - width;
        top = anchor.top - height - 8;
      }
    }
    mapToolsPanel.style.left = `${Math.max(bounds.left, Math.min(left, bounds.right - width))}px`;
    mapToolsPanel.style.top = `${Math.max(bounds.top, Math.min(top, bounds.bottom - height))}px`;
  }

  function setMapToolsOpen(open, restoreFocus = false) {
    const focused = document.activeElement;
    const panelHadFocus = mapToolsPanel.contains(focused);
    mapToolsOpen = Boolean(open && isCompact && !activeOverlay);
    syncMapTools();
    if (mapToolsOpen) {
      window.JourneyControls?.close();
      positionMapTools();
    } else if (isCompact && panelHadFocus) {
      if (restoreFocus) mapToolsToggle.focus({ preventScroll: true });
      else focused.blur();
    }
  }

  mapToolsToggle.addEventListener('click', () => setMapToolsOpen(!mapToolsOpen, true));
  document.addEventListener('pointerdown', event => {
    if (mapToolsOpen && !mapTools.contains(event.target)) setMapToolsOpen(false);
  }, true);
  document.addEventListener('focusin', event => {
    if (mapToolsOpen && !mapTools.contains(event.target)) setMapToolsOpen(false);
  });
  let toolsViewport = `${window.innerWidth}:${window.innerHeight}`;
  window.addEventListener('resize', () => {
    const viewport = `${window.innerWidth}:${window.innerHeight}`;
    if (viewport !== toolsViewport) setMapToolsOpen(false, true);
    else positionMapTools();
    toolsViewport = viewport;
  });

  function syncArchiveLayout() {
    const drawer = usesArchiveDrawer();
    const expanded = drawer ? sidebar.classList.contains('visible') : !archiveCollapsed;
    document.body.classList.toggle('archive-drawer', drawer);
    document.body.classList.toggle('archive-collapsed', !drawer && archiveCollapsed);
    sidebar.hidden = !drawer && archiveCollapsed;
    // Keep one summary: beneath the desktop list, or inside the active drawer.
    const summaryParent = drawer ? sidebar : $('timeline-control');
    if (archiveSummary.parentElement !== summaryParent) {
      if (drawer) summaryParent.append(archiveSummary);
      else summaryParent.prepend(archiveSummary);
    }
    archiveSummary.hidden = !drawer && archiveCollapsed;
    sidebar.setAttribute('aria-hidden', String(!expanded));
    $('journey-toggle').setAttribute('aria-expanded', String(expanded));
    if (drawer) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
    syncBackgroundInert();
  }

  function setCompactLayout() {
    window.JourneyControls?.close();
    const wasCompact = isCompact;
    const sidebarHadFocus = archiveContainsFocus();
    const languageHadFocus = $('language-selector').contains(document.activeElement);
    const mapToggleHadFocus = document.activeElement === mapToolsToggle;
    isCompact = compactQuery.matches || shortQuery.matches || nativeAndroid;
    document.body.classList.toggle('compact', isCompact);
    setMapToolsOpen(false, true);
    if (wasCompact !== isCompact) dismissArchiveDrawer();
    const language = $('language-selector');
    const languageSection = $('settings-language');
    if (isCompact) languageSection.append(language);
    else document.querySelector('.header-actions').prepend(language);
    languageSection.hidden = !isCompact;
    syncArchiveLayout();
    if (wasCompact !== isCompact) {
      if (mapToggleHadFocus && !isCompact) {
        (mapToolsPanel.querySelector('.map-view-tools button:not(:disabled)') || $('settings-btn')).focus({ preventScroll: true });
      }
      if (sidebarHadFocus) {
        const target = sidebar.inert ? $('journey-toggle') : ($('journey-search').disabled ? $('journey-close') : $('journey-search'));
        target.focus({ preventScroll: true });
      }
      if (languageHadFocus) {
        const target = activeOverlay?.querySelector('.dialog-header button') || $('settings-btn');
        target.focus({ preventScroll: true });
      }
    }
  }
  compactQuery.addEventListener('change', setCompactLayout);
  shortQuery.addEventListener('change', setCompactLayout);

  function setViewMode(mode, persist = true) {
    if (!['playback', 'browse'].includes(mode)) return;
    window.JourneyControls?.close();
    setMapToolsOpen(false, true);
    const focused = document.activeElement;
    const sidebarHadFocus = archiveContainsFocus();
    dismissArchiveDrawer();
    viewMode = mode;
    document.body.dataset.viewMode = mode;
    if (mode === 'playback') {
      dock.append(eventCard, $('timeline-control'));
      dock.hidden = false;
    } else {
      document.querySelector('.map-column').append(eventCard);
      $('container').insertBefore($('timeline-control'), $('settings-panel'));
      dock.hidden = true;
    }
    document.querySelectorAll('button[data-view-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.viewMode === mode));
    });
    syncArchiveLayout();
    if (sidebarHadFocus && sidebar.inert) document.querySelector(`button[data-view-mode="${mode}"]`).focus({ preventScroll: true });
    else if (focused !== document.body && !focused.closest('[hidden], [inert]')) focused.focus({ preventScroll: true });
    if (persist) savePreference('view-mode', mode);
    window.dispatchEvent(new Event('resize'));
  }

  function setSkin(value, persist = true) {
    if (!['classic', 'paper'].includes(value)) return;
    skin = value;
    document.body.dataset.skin = skin;
    $('skin-select').value = skin;
    window.JourneyControls?.sync($('skin-select'));
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', skin === 'classic' ? '#f5f7fa' : '#f6f3ec');
    window.JourneyMap?.refreshAppearance();
    if (persist) savePreference('skin', skin);
  }

  function syncFoldControl() {
    const label = t(eventCollapsed ? 'showEvent' : 'hideEvent');
    $('event-card-toggle').setAttribute('aria-expanded', String(!eventCollapsed));
    $('event-card-toggle').setAttribute('aria-label', label);
    $('event-card-toggle').title = label;
  }

  function initGlassSettings() {
    const settings = [
      { id: 'glass-transparency', max: 80, fallback: 35, unit: '%', variable: '--glass-alpha', cssValue: value => String((100 - value) / 100) },
      { id: 'glass-blur', max: 30, fallback: 5, unit: 'px', variable: '--glass-blur', cssValue: value => `${value}px` },
    ];
    settings.forEach(setting => {
      const input = $(setting.id);
      const apply = (value, persist) => {
        input.value = String(value);
        const display = `${value}${setting.unit}`;
        $(`${setting.id}-display`).textContent = display;
        input.setAttribute('aria-valuetext', display);
        document.body.style.setProperty(setting.variable, setting.cssValue(value));
        window.JourneyControls?.sync(input);
        if (persist) savePreference(setting.id, value);
      };
      apply(numberPreference(setting.id, 0, setting.max, setting.fallback), false);
      input.addEventListener('input', () => apply(Number(input.value), true));
    });
  }

  function setEventCollapsed(collapsed, persist = true) {
    eventCollapsed = collapsed;
    if (collapsed && eventCard.contains(document.activeElement)) $('event-card-toggle').focus({ preventScroll: true });
    eventCard.hidden = collapsed;
    eventCard.inert = collapsed || !!activeOverlay;
    document.body.classList.toggle('event-collapsed', collapsed);
    syncFoldControl();
    if (persist) savePreference('event-collapsed', collapsed);
    window.dispatchEvent(new Event('resize'));
  }
  document.querySelectorAll('button[data-view-mode]').forEach(button => button.addEventListener('click', () => setViewMode(button.dataset.viewMode)));
  $('skin-select').addEventListener('change', event => setSkin(event.target.value));
  $('event-card-toggle').addEventListener('click', () => setEventCollapsed(!eventCollapsed));

  function renderPeriods() {
    const options = [new Option(t('allPeriods'), 'all')];
    periods.forEach(period => options.push(new Option(`${t(`periods.${period.id}`)} · ${period.start}—${period.end}`, period.id)));
    $('period-select').replaceChildren(...options);
    $('period-select').value = selectedPeriod;
    window.JourneyControls?.sync($('period-select'));
  }

  function matchesFilters(event) {
    const period = $('period-select').value;
    if (period !== 'all' && periodOf(event).id !== period) return false;
    const query = $('journey-search').value.trim().toLocaleLowerCase();
    const text = [event.date, event.event, event.startLocation, event.endLocation,
      event.movementType, ...Object.values(event.coordinates?.end || {}),
      ...(event.coordinates?.transit || []).map(shortPlace)].join(' ').toLocaleLowerCase();
    return query.split(/\s+/).every(part => text.includes(part));
  }

  function renderList() {
    const filtered = events.filter(matchesFilters);
    const fragment = document.createDocumentFragment();
    let previousPeriod = null;
    filtered.forEach(event => {
      const period = periodOf(event);
      if (period.id !== previousPeriod) {
        const heading = make('h3', 'journey-group');
        heading.append(make('strong', '', t(`periods.${period.id}`)), make('span', '', `${period.start}—${period.end}`));
        fragment.append(heading);
        previousPeriod = period.id;
      }
      const item = make('button', 'journey-item');
      item.type = 'button';
      item.dataset.index = event.index;
      item.setAttribute('aria-current', event.index === currentIndex ? 'step' : 'false');
      const meta = make('span', 'journey-item-meta');
      const location = shortPlace(event.coordinates?.end) || event.endLocation || t('unknownPlace');
      const place = make('span', 'journey-item-place', location);
      place.title = event.endLocation || location;
      meta.append(make('time', 'journey-item-date', event.date), place);
      item.append(meta, make('span', 'journey-item-title', event.event));
      fragment.append(item);
    });
    $('journey-list').replaceChildren(fragment);
    $('journey-list').hidden = filtered.length === 0;
    $('journey-empty').hidden = filtered.length !== 0;
    $('journey-results').removeAttribute('data-i18n');
    const filteredView = $('period-select').value !== 'all' || $('journey-search').value.trim();
    $('journey-results').textContent = t(filteredView ? 'resultCount' : 'totalRecords', { count: filtered.length, total: events.length });
    $('journey-results').classList.toggle('sr-only', !filteredView);
    window.JourneyControls?.sync($('period-select'));
    $('clear-search').hidden = !$('journey-search').value;
    return filtered;
  }

  function scrollToCurrent({ focus = false } = {}) {
    const item = $('journey-list').querySelector(`[data-index="${currentIndex}"]`);
    if (!item) return;
    item.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    if (focus) item.focus({ preventScroll: true });
  }

  function resetFilters() {
    $('journey-search').value = '';
    selectedPeriod = 'all';
    savePreference('period', selectedPeriod);
    $('period-select').value = 'all';
    renderList();
  }

  function renderSourceText(text) {
    const container = $('event-verification');
    container.replaceChildren();
    const urls = /https?:\/\/[^\s<>]+/g;
    let offset = 0;
    for (const match of text.matchAll(urls)) {
      container.append(document.createTextNode(text.slice(offset, match.index)));
      const url = match[0].replace(/[.,;，。；）)]+$/, '');
      const link = make('a', '', url);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.addEventListener('click', event => {
        if (typeof window.openExternalUrl === 'function') { event.preventDefault(); window.openExternalUrl(link.href); }
      });
      container.append(link, document.createTextNode(match[0].slice(url.length)));
      offset = match.index + match[0].length;
    }
    container.append(document.createTextNode(text.slice(offset)));
  }

  function renderCurrent(event, index, preview = false) {
    if (!event) return;
    isPreviewing = preview;
    if (!preview) currentIndex = index;
    $('event-title').removeAttribute('data-i18n');
    $('event-title').textContent = event.event;
    $('event-date').textContent = event.date;
    $('event-location').textContent = event.endLocation || shortPlace(event.coordinates?.end) || t('unknownPlace');
    $('event-type').textContent = event.movementType || t('record');
    $('current-period').textContent = t(`periods.${periodOf(event).id}`);
    const verification = typeof event.verification === 'string' ? event.verification.trim() : '';
    const notes = (event.userVerification || []).filter(note => note.comment).map(note =>
      [note.username, note.date, note.comment].filter(Boolean).join(' · '));
    renderSourceText([verification || t('noSource'), ...notes].join('\n\n'));
    $('source-status').textContent = verification ? t('hasSource') : t('sourcePending');
    const expected = [event.coordinates?.start, ...(event.coordinates?.transit || []), event.coordinates?.end].filter(Boolean).length;
    const resolved = [event.startCoords, ...(event.transitCoords || []), event.endCoords].filter(Boolean).length;
    $('coordinate-note').textContent = expected > resolved ? t('partialCoordinates') : t('coordinateNote');
    const stops = [event.coordinates?.start, ...(event.coordinates?.transit || []), event.coordinates?.end]
      .map(shortPlace).filter((value, placeIndex, all) => value && (placeIndex === 0 || value !== all[placeIndex - 1]));
    const route = $('event-route');
    route.replaceChildren();
    if (stops.length > 1) {
      stops.forEach((place, placeIndex) => {
        if (placeIndex) {
          const arrow = make('span', 'route-arrow');
          arrow.innerHTML = window.JourneyIcons.svg('arrow-right');
          arrow.setAttribute('aria-hidden', 'true');
          route.append(arrow);
        }
        route.append(make('span', 'route-stop', place));
      });
      route.setAttribute('aria-label', t('routeDescription', { places: stops.join(' → ') }));
    } else {
      route.append(make('span', 'stationary-note', t(event.movementType === '出生' || event.movementType === 'Birth' ? 'firstFootprint' : 'localRecord')));
      route.removeAttribute('aria-label');
    }
    if (!preview) {
      $('journey-list').querySelectorAll('.journey-item').forEach(item => {
        item.setAttribute('aria-current', Number(item.dataset.index) === index ? 'step' : 'false');
      });
      if (window.JourneyMap?.isPlaying() && !sidebar.contains(document.activeElement)) scrollToCurrent();
    }
    updatePlaybackStatus();
    syncPoetryEntry();
  }

  function updatePlaybackStatus() {
    if (!events.length) return;
    $('playback-status').removeAttribute('data-i18n');
    $('playback-status').textContent = t(isPreviewing ? 'preview' : window.JourneyMap?.isPlaying() ? 'playing' : currentIndex === events.length - 1 ? 'finished' : 'explore');
  }

  function setData(nextEvents) {
    events = nextEvents;
    currentIndex = window.JourneyMap.getCurrentIndex();
    syncRouteScope(window.JourneyMap.getRouteScope?.() || 'all');
    renderPeriods();
    renderList();
    renderCurrent(events[currentIndex], currentIndex);
    // The slider steps through records, so year marks follow record positions.
    document.querySelectorAll('.timeline-years span').forEach(tick => {
      const year = Number(tick.textContent);
      let index = events.findIndex(event => Number.parseInt(event.date, 10) >= year);
      if (index < 0 || year === 1976) index = events.length - 1;
      tick.style.setProperty('--tick-position', `${index / Math.max(1, events.length - 1) * 100}%`);
    });
    ['copy-event', 'read-event', 'focus-current', 'fit-journey', 'find-current', 'period-select', 'journey-search'].forEach(id => { $(id).disabled = !events.length; });
    syncControlLabels();
  }

  $('journey-search').addEventListener('compositionstart', () => { composing = true; });
  $('journey-search').addEventListener('compositionend', () => { composing = false; renderList(); });
  $('journey-search').addEventListener('input', () => { if (!composing) renderList(); });
  $('clear-search').addEventListener('click', () => { $('journey-search').value = ''; renderList(); $('journey-search').focus(); });
  $('period-select').addEventListener('change', () => {
    selectedPeriod = $('period-select').value;
    savePreference('period', selectedPeriod);
    const filtered = renderList();
    if (filtered.length && $('period-select').value !== 'all') window.JourneyMap.goTo(filtered[0].index);
    $('journey-list').scrollTop = 0;
  });
  $('reset-filters').addEventListener('click', () => { resetFilters(); $('journey-search').focus(); });
  $('find-current').addEventListener('click', () => { resetFilters(); scrollToCurrent({ focus: true }); });
  $('journey-list').addEventListener('click', event => {
    const item = event.target.closest('.journey-item');
    if (!item) return;
    if (window.JourneyMap.goTo(Number(item.dataset.index))) {
      if (usesArchiveDrawer()) closeSidebar();
      $('journey-announcement').textContent = `${events[currentIndex].date}，${events[currentIndex].event}`;
    }
  });
  $('focus-current').addEventListener('click', () => {
    window.JourneyMap?.focusCurrent();
    setMapToolsOpen(false, true);
  });
  function syncRouteScope(scope) {
    document.body.classList.toggle('scope-current', scope === 'current');
    document.querySelectorAll('[data-scope]').forEach(item => {
      item.classList.toggle('active', item.dataset.scope === scope);
      item.setAttribute('aria-pressed', String(item.dataset.scope === scope));
    });
  }
  function chooseRouteScope(scope) {
    if (!window.JourneyMap?.setRouteScope(scope)) return;
    syncRouteScope(scope);
    if (scope === 'current') window.JourneyMap.focusCurrent();
    else window.JourneyMap.fitJourney();
    setMapToolsOpen(false, true);
  }
  $('fit-journey').addEventListener('click', () => chooseRouteScope('all'));
  document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => chooseRouteScope(button.dataset.scope)));
  $('read-event').addEventListener('click', () => {
    source.open = !source.open;
  });
  function syncSourceControl() {
    eventCard.classList.toggle('source-expanded', source.open);
    $('read-event').setAttribute('aria-expanded', String(source.open));
    $('read-event').querySelector('span').removeAttribute('data-i18n');
    $('read-event').querySelector('span').textContent = t(source.open ? 'closeSource' : 'readMore');
  }
  source.addEventListener('toggle', () => {
    if (source.open && window.JourneyMap?.isPlaying()) window.JourneyMap.togglePlay();
    syncSourceControl();
    savePreference('source-expanded', source.open);
  });
  $('copy-event').addEventListener('click', () => window.JourneyMap?.copyCurrentEventData());

  function syncPoetryEntry() {
    const available = !isPreviewing && events.length > 0 && currentIndex === events.length - 1;
    poetryEntry.hidden = !available;
    $('current-progress-desktop').hidden = available;
    $('timeline-control').classList.toggle('journey-complete', available);
  }

  function renderPoetry() {
    const poems = i18n.t('poems');
    if (!Array.isArray(poems) || !poems.length) return;
    const text = poems[poemIndex] || poems[0];
    const lines = text.split(/(?<=，)|\s*\/\s*/u).filter(Boolean).map((line, index) => {
      const element = make('span', 'poetry-line', line.trim());
      element.style.setProperty('--line-index', index);
      return element;
    });
    $('poetry-quote').replaceChildren(...lines);
    $('poetry-next').disabled = poems.length < 2;
  }

  function nextPoem() {
    const poems = i18n.t('poems');
    if (!Array.isArray(poems) || !poems.length) return;
    if (!poemOrder.length) {
      poemOrder = poems.map((_, index) => index);
      for (let index = poemOrder.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [poemOrder[index], poemOrder[other]] = [poemOrder[other], poemOrder[index]];
      }
      // Read every verse before reshuffling, without repeating at a cycle boundary.
      const last = poemOrder.length - 1;
      if (last > 0 && poemOrder[last] === poemIndex) [poemOrder[0], poemOrder[last]] = [poemOrder[last], poemOrder[0]];
    }
    poemIndex = poemOrder.pop();
    renderPoetry();
  }

  function showPoetry() {
    if (poetryEntry.hidden || poetryDialog.classList.contains('visible')) return;
    poetryPending = false;
    nextPoem();
    $('poetry-backdrop').classList.add('visible');
    poetryDialog.classList.add('visible');
    activateOverlay(poetryDialog);
  }

  function hidePoetry() {
    poetryDialog.classList.remove('visible');
    $('poetry-backdrop').classList.remove('visible');
    poetryDialog.inert = true;
    poetryDialog.setAttribute('aria-hidden', 'true');
    releaseOverlay(poetryDialog);
  }

  function queuePoetryReveal() {
    cancelAnimationFrame(poetryFrame);
    poetryFrame = requestAnimationFrame(() => {
      poetryFrame = null;
      // Let timeline commits and drawer closing finish; never interrupt another dialog.
      if (poetryPending && completionReached && !isPreviewing && !activeOverlay) showPoetry();
    });
  }

  function syncJourneyCompletion() {
    const complete = events.length > 0 && currentIndex === events.length - 1;
    if (!complete) {
      completionReached = false;
      poetryPending = false;
      cancelAnimationFrame(poetryFrame);
      poetryFrame = null;
      hidePoetry();
      return;
    }
    if (!completionReached) {
      completionReached = true;
      poetryPending = true;
    }
    if (poetryPending) queuePoetryReveal();
  }

  poetryEntry.addEventListener('click', showPoetry);
  $('poetry-next').addEventListener('click', nextPoem);
  ['poetry-close', 'poetry-return', 'poetry-backdrop'].forEach(id => $(id).addEventListener('click', hidePoetry));
  $('poetry-replay').addEventListener('click', () => {
    hidePoetry();
    window.JourneyMap?.togglePlay();
    $('play-btn').focus({ preventScroll: true });
  });
  $('poetry-recall').addEventListener('click', () => {
    hidePoetry();
    document.dispatchEvent(new Event('journey:recall'));
  });

  const trailPoem = $('trail-poem-modal');
  document.addEventListener('journey:open-poem', () => {
    $('trail-poem-backdrop').classList.add('visible');
    trailPoem.classList.add('visible');
    activateOverlay(trailPoem);
  });
  function hideTrailPoem() {
    trailPoem.classList.remove('visible');
    $('trail-poem-backdrop').classList.remove('visible');
    trailPoem.inert = true;
    trailPoem.setAttribute('aria-hidden', 'true');
    releaseOverlay(trailPoem);
  }
  ['trail-poem-close', 'trail-poem-return', 'trail-poem-backdrop'].forEach(id => $(id).addEventListener('click', hideTrailPoem));
  document.addEventListener('journey:event-change', hideTrailPoem);

  const dialogs = [...document.querySelectorAll('.surface-dialog')];
  const closeButtons = {
    'settings-panel': 'settings-panel-close', 'music-modal': 'music-modal-close',
    'feedback-modal': 'feedback-modal-close', 'wechat-qr-modal': 'wechat-qr-close',
    'location-detail-panel': 'panel-close-btn',
    'poetry-modal': 'poetry-close',
    'trail-poem-modal': 'trail-poem-close',
  };
  function closeDialog(dialog) {
    if (dialog?.classList.contains('visible')) $(closeButtons[dialog.id]).click();
  }
  function syncBackgroundInert() {
    const hasOverlay = !!activeOverlay;
    const hideArchiveEntry = nativeAndroid && viewMode === 'playback';
    $('journey-toggle').hidden = hideArchiveEntry || (usesArchiveDrawer() ? sidebar.classList.contains('visible') : !archiveCollapsed);
    document.querySelector('.skip-link').hidden = hideArchiveEntry;
    $('map').inert = hasOverlay;
    document.querySelector('.app-header').inert = hasOverlay;
    document.querySelector('.map-column').inert = hasOverlay;
    $('timeline-control').inert = hasOverlay;
    dock.inert = hasOverlay;
    eventCard.inert = hasOverlay || eventCollapsed;
    sidebar.inert = (hasOverlay && activeOverlay !== sidebar) || (usesArchiveDrawer() ? !sidebar.classList.contains('visible') : archiveCollapsed);
  }
  function activateOverlay(overlay) {
    if (activeOverlay === overlay) return;
    window.JourneyControls?.close();
    setMapToolsOpen(false, true);
    const previous = activeOverlay;
    const opener = overlay === poetryDialog ? poetryEntry : previous ? returnFocus : document.activeElement;
    activeOverlay = overlay;
    returnFocus = opener;
    if (previous === sidebar) {
      sidebar.classList.remove('visible');
      $('journey-backdrop').classList.remove('visible');
      $('journey-toggle').setAttribute('aria-expanded', 'false');
    } else if (previous) closeDialog(previous);
    overlay.inert = false;
    overlay.setAttribute('aria-hidden', 'false');
    syncBackgroundInert();
    if (overlay.id !== 'settings-panel' && window.JourneyMap?.isPlaying()) window.JourneyMap.togglePlay();
    const focusTarget = overlay === sidebar
      ? ($('journey-search').disabled ? $('journey-close') : $('journey-search'))
      : overlay.querySelector('.dialog-header button');
    (focusTarget || overlay).focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('journey:overlay-change', { detail: { id: overlay.id } }));
  }
  function releaseOverlay(overlay) {
    if (activeOverlay !== overlay) return;
    window.JourneyControls?.close();
    activeOverlay = null;
    syncBackgroundInert();
    const fallback = document.querySelector(`button[data-view-mode="${viewMode}"]`);
    const target = returnFocus?.isConnected && !returnFocus.disabled && !returnFocus.closest('[hidden], [inert]') ? returnFocus : fallback;
    target.focus({ preventScroll: true });
    returnFocus = null;
    document.dispatchEvent(new CustomEvent('journey:overlay-change', { detail: { id: null } }));
    if (poetryPending) queuePoetryReveal();
  }
  function openSidebar() {
    if (!usesArchiveDrawer()) {
      archiveCollapsed = false;
      savePreference('archive-collapsed', false);
      syncArchiveLayout();
      ($('journey-search').disabled ? $('journey-close') : $('journey-search')).focus({ preventScroll: true });
      window.dispatchEvent(new Event('resize'));
      return;
    }
    sidebar.classList.add('visible');
    $('journey-backdrop').classList.add('visible');
    $('journey-toggle').setAttribute('aria-expanded', 'true');
    activateOverlay(sidebar);
    scrollToCurrent();
  }
  function dismissArchiveDrawer() {
    sidebar.classList.remove('visible');
    $('journey-backdrop').classList.remove('visible');
    $('journey-toggle').setAttribute('aria-expanded', 'false');
    releaseOverlay(sidebar);
  }
  function closeSidebar() {
    window.JourneyControls?.close();
    const hadFocus = archiveContainsFocus();
    dismissArchiveDrawer();
    if (!usesArchiveDrawer()) {
      archiveCollapsed = true;
      savePreference('archive-collapsed', true);
    }
    syncArchiveLayout();
    if (hadFocus) $('journey-toggle').focus({ preventScroll: true });
    window.dispatchEvent(new Event('resize'));
  }
  $('journey-toggle').addEventListener('click', openSidebar);
  $('journey-close').addEventListener('click', closeSidebar);
  $('journey-backdrop').addEventListener('click', closeSidebar);
  document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); openSidebar(); });
  $('settings-backdrop').addEventListener('click', () => closeDialog($('settings-panel')));
  const dialogObserver = new MutationObserver(records => {
    records.forEach(({ target }) => {
      const visible = target.classList.contains('visible');
      target.inert = !visible;
      target.setAttribute('aria-hidden', String(!visible));
      if (target.id === 'settings-panel') {
        $('settings-backdrop').classList.toggle('visible', visible);
        $('settings-btn').setAttribute('aria-expanded', String(visible));
      }
      if (visible) activateOverlay(target);
      else releaseOverlay(target);
    });
  });
  dialogs.forEach(dialog => {
    dialogObserver.observe(dialog, { attributes: true, attributeFilter: ['class'] });
    dialog.setAttribute('aria-hidden', 'true');
  });
  document.addEventListener('keydown', event => {
    if (mapToolsOpen && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setMapToolsOpen(false, true);
      return;
    }
    if (!activeOverlay) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      activeOverlay === sidebar ? closeSidebar() : closeDialog(activeOverlay);
    } else if (event.key === 'Tab') {
      const focusable = [...activeOverlay.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]')]
        .filter(element => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); activeOverlay.focus(); return; }
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !activeOverlay.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeOverlay.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  }, true);

  function syncControlLabels() {
    document.querySelectorAll('.tool-button[title]').forEach(button => button.setAttribute('aria-label', button.title));
    document.querySelectorAll('.lang-btn, .follow-mode-btn').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    $('journey-search').setAttribute('aria-label', $('journey-search').placeholder);
    $('journey-toggle').setAttribute('aria-label', t('timeline'));
    document.querySelector('.music-progress-bar').setAttribute('aria-label', t('musicProgress'));
    syncFoldControl();
    syncMapTools();
    positionMapTools();
  }
  document.querySelectorAll('.lang-btn, .follow-mode-btn').forEach(button => {
    new MutationObserver(syncControlLabels).observe(button, { attributes: true, attributeFilter: ['class'] });
  });
  new MutationObserver(updatePlaybackStatus).observe($('play-btn'), { attributes: true, attributeFilter: ['aria-pressed'] });
  const playlist = $('music-playlist-items');
  new MutationObserver(() => {
    playlist.querySelectorAll('.playlist-item').forEach(item => {
      item.setAttribute('role', 'button'); item.tabIndex = 0;
      item.setAttribute('aria-pressed', String(item.classList.contains('active')));
    });
  }).observe(playlist, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  playlist.addEventListener('keydown', event => {
    const item = event.target.closest('.playlist-item');
    if (item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); item.click(); }
  });
  const audio = $('music-audio');
  const seek = document.querySelector('.music-progress-bar');
  seek.addEventListener('keydown', event => {
    if (!Number.isFinite(audio.duration)) return;
    const positions = { ArrowLeft: audio.currentTime - 5, ArrowRight: audio.currentTime + 5, Home: 0, End: audio.duration };
    if (!(event.key in positions)) return;
    event.preventDefault();
    audio.currentTime = Math.min(audio.duration, Math.max(0, positions[event.key]));
  });
  audio.addEventListener('timeupdate', () => {
    seek.setAttribute('aria-valuenow', String(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.currentTime / audio.duration * 100) : 0));
  });
  new MutationObserver(() => {
    const playing = $('music-btn').classList.contains('playing');
    $('music-play-btn').setAttribute('aria-label', i18n.t(playing ? 'ui.controls.pause' : 'ui.controls.play'));
    $('music-play-btn').setAttribute('aria-pressed', String(playing));
  }).observe($('music-btn'), { attributes: true, attributeFilter: ['class'] });
  if (window.ResizeObserver) {
    let resizeFrame;
    const layoutObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        document.body.style.setProperty('--dock-height', `${dock.hidden ? 0 : Math.ceil(dock.getBoundingClientRect().height)}px`);
        window.dispatchEvent(new Event('resize'));
      });
    });
    layoutObserver.observe($('map'));
    layoutObserver.observe($('map-stage'));
    layoutObserver.observe(dock);
  }
  document.addEventListener('journey:data-ready', event => setData(event.detail.events));
  document.addEventListener('journey:event-change', event => {
    renderCurrent(event.detail.event, event.detail.index);
    syncJourneyCompletion();
  });
  document.addEventListener('journey:event-preview', event => renderCurrent(event.detail.event, event.detail.index, true));
  document.addEventListener('journey:locale-change', () => {
    syncControlLabels();
    syncSourceControl();
    if (poemIndex >= 0) renderPoetry();
    if (events.length) { renderPeriods(); renderList(); renderCurrent(events[currentIndex], currentIndex); }
  });
  ['copy-event', 'read-event', 'focus-current', 'fit-journey', 'find-current', 'period-select', 'journey-search'].forEach(id => { $(id).disabled = true; });
  setCompactLayout();
  setViewMode(viewMode, false);
  setSkin(skin, false);
  initGlassSettings();
  setEventCollapsed(eventCollapsed, false);
  source.open = preference('source-expanded', ['true', 'false'], 'false') === 'true';
  syncSourceControl();
  if (window.JourneyMap?.getEvents().length) setData(window.JourneyMap.getEvents());
})();
