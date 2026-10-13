/* Small, optional discoveries along the existing journey. No changes to historical data. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = (key, vars) => i18n.t(`journey.moments.${key}`, vars);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stamps = [
    { id: 'shaoshan', matches: /韶山|shaoshan/i },
    { id: 'changsha', matches: /长沙|changsha/i },
    { id: 'jinggangshan', matches: /井冈山|jinggangshan/i },
    { id: 'ruijin', matches: /瑞金|ruijin/i },
    { id: 'zunyi', matches: /遵义|zunyi/i },
    { id: 'yanan', matches: /延安|yan['’]?an/i },
    { id: 'beijing', matches: /北京|beijing/i },
  ];
  // Associate excerpts with existing records by date, never by translated array index.
  // Context explicitly separates a poem's composition date from the displayed event.
  const poems = [
    { id: 'changsha', eventDate: '1927-01-04', date: '1925',
      lines: ['鹰击长空，', '鱼翔浅底。'],
      source: 'https://theory.people.com.cn/n1/2024/0729/c40764-40288014.html' },
    { id: 'autumn', eventDate: '1927-09-29', date: '1927',
      lines: ['秋收时节暮云愁，', '霹雳一声暴动。'],
      source: 'https://dangshi.people.com.cn/n/2013/1202/c85037-23719299.html' },
    { id: 'march', eventDate: '1935-10-19', date: '1935.10',
      lines: ['红军不怕远征难，', '万水千山只等闲。'],
      source: 'https://dangshi.people.com.cn/n1/2016/0829/c85037-28672236.html' },
  ];
  const visited = new Set();
  const introTimers = new Set();
  const recallTimers = new Set();
  let map;
  let musicLayer;
  let recallLayer;
  let events = [];
  let index = 0;
  let previewing = false;
  let activePoem = null;
  let openPoem = null;
  let currentStamp = null;
  let overlayId = null;
  let music = { playing: false };
  let introShownForSelection = false;
  let introSong = null;
  let recalling = false;
  let recallComplete = false;
  let restoreRecallView = null;
  const stamp = $('trail-stamp');
  const poemButton = $('trail-poem-open');
  const recall = $('journey-recollection');
  const prelude = document.createElement('div');
  prelude.id = 'music-prelude';
  prelude.className = 'music-prelude';
  prelude.hidden = true;
  prelude.setAttribute('aria-hidden', 'true');
  document.querySelector('.current-song-info').prepend(prelude);

  function later(timers, callback, delay) {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  }
  function clearTimers(timers) {
    timers.forEach(clearTimeout);
    timers.clear();
  }
  const coordinatesOf = event => [event.startCoords, ...(event.transitCoords || []), event.endCoords];
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  const latLng = ([lng, lat]) => [lat, lng];

  function renderKeepsakes(event, preview = false, collect = true) {
    previewing = preview;
    if (!event) return;
    const place = event.coordinates?.end || {};
    const placeText = Object.values(place).join(' ');
    const found = stamps.find(candidate => candidate.matches.test(placeText)
      // Wuqi belongs to today's Yan'an prefecture, but is not a visit to Yan'an city.
      && !(candidate.id === 'yanan' && place.district));
    const nextStamp = !preview && validPoint(event.endCoords) ? found : null;
    if (currentStamp !== nextStamp?.id) stamp.classList.remove('is-new');
    currentStamp = nextStamp?.id || null;
    stamp.hidden = !nextStamp;
    if (nextStamp) {
      const name = t(`places.${nextStamp.id}`);
      $('trail-stamp-place').textContent = name;
      $('trail-stamp-year').textContent = event.date.slice(0, 4);
      stamp.title = t('openStamp', { place: name });
      stamp.setAttribute('aria-label', `${name} · ${event.date.slice(0, 4)} · ${t('stampHint')}`);
      if (collect && !visited.has(nextStamp.id)) {
        visited.add(nextStamp.id);
        if (!motion.matches && !document.hidden && !$('current-event-card').hidden) stamp.classList.add('is-new');
      }
    }
    activePoem = preview ? null : poems.find(poem => poem.eventDate === event.date) || null;
    poemButton.hidden = !activePoem;
    poemButton.title = activePoem ? t(`poems.${activePoem.id}.title`) : '';
    $('event-keepsakes').hidden = !nextStamp && !activePoem;
  }
  stamp.addEventListener('animationend', () => stamp.classList.remove('is-new'));
  stamp.addEventListener('click', event => {
    // The location archive's outside-click listener must not close its new opener.
    event.stopPropagation();
    if (!stamp.hidden && !previewing) window.JourneyMap?.openCurrentPlaceArchive();
  });

  function renderPoem(poem) {
    $('trail-poem-heading').textContent = t(`poems.${poem.id}.title`);
    $('trail-poem-date').textContent = t('poemDate', { date: poem.date });
    $('trail-poem-context').textContent = t(`poems.${poem.id}.context`);
    const lines = poem.lines.map((text, position) => {
      const line = document.createElement('span');
      line.className = 'poetry-line';
      line.style.setProperty('--line-index', position);
      line.textContent = text;
      return line;
    });
    $('trail-poem-quote').replaceChildren(...lines);
    $('trail-poem-source').textContent = t('poemSource');
    $('trail-poem-source').href = poem.source;
  }
  poemButton.addEventListener('click', () => {
    if (!activePoem || previewing) return;
    openPoem = activePoem;
    renderPoem(openPoem);
    document.dispatchEvent(new Event('journey:open-poem'));
  });
  $('trail-poem-source').addEventListener('click', event => {
    if (typeof window.openExternalUrl === 'function') {
      event.preventDefault();
      window.openExternalUrl(event.currentTarget.href);
    }
  });

  function addStar(layer, point, final = false) {
    L.circleMarker(latLng(point), {
      pane: 'journey-moments', interactive: false, radius: final ? 7 : 4,
      color: '#927348', fillColor: '#ead5a3', weight: 1.5, fillOpacity: .95,
      className: `moment-star${final ? ' moment-star-current' : ''}`,
    }).addTo(layer);
  }
  function stopIntro() {
    clearTimers(introTimers);
    musicLayer?.clearLayers();
    prelude.hidden = true;
    delete prelude.dataset.song;
    introSong = null;
  }
  function playIntro() {
    if (!music.playing || music.isLocal || !['internationale', 'dongfanghong'].includes(music.id)) {
      stopIntro();
      return;
    }
    if (introSong === music.id) return;
    stopIntro();
    if (introShownForSelection || recalling || document.hidden || (overlayId && overlayId !== 'music-modal')) return;
    introShownForSelection = true;
    introSong = music.id;
    prelude.dataset.song = music.id;
    // Flush the hidden state so a quick track switch also restarts the CSS opening.
    void prelude.offsetWidth;
    prelude.hidden = false;
    if (music.id === 'internationale' && musicLayer) {
      const unique = new Map();
      events.slice(0, index + 1).flatMap(coordinatesOf).filter(validPoint).forEach(point => {
        // Keep the latest occurrence so the final star is always the current location.
        unique.delete(point.join(','));
        unique.set(point.join(','), point);
      });
      const points = [...unique.values()];
      const count = Math.min(points.length, 8);
      for (let step = 0; step < count; step++) {
        const point = points[count === 1 ? 0 : Math.round(step * (points.length - 1) / (count - 1))];
        const draw = () => addStar(musicLayer, point, step === count - 1);
        if (motion.matches) draw();
        else later(introTimers, draw, 160 + step * 160);
      }
    }
    later(introTimers, stopIntro, 2600);
  }

  function renderRecallText() {
    if (!recalling) return;
    const first = events[0]?.date.slice(0, 4);
    const last = events[index]?.date.slice(0, 4);
    $('recollection-years').textContent = `${first} — ${last}`;
    $('recollection-status').textContent = t(recallComplete ? 'recallComplete' : 'recallDrawing');
  }
  function stopRecall(restoreFocus = false) {
    if (!recalling) return;
    const heldFocus = recall.contains(document.activeElement);
    clearTimers(recallTimers);
    recallLayer?.clearLayers();
    restoreRecallView?.();
    restoreRecallView = null;
    recalling = false;
    recallComplete = false;
    recall.hidden = true;
    delete recall.dataset.state;
    // Explicitly ending the experience returns to its persistent finale entry.
    if ((restoreFocus || heldFocus) && !overlayId) {
      ($('poetry-open').hidden ? $('play-btn') : $('poetry-open')).focus({ preventScroll: true });
    }
  }
  function startRecall() {
    const api = window.JourneyMap;
    if (!map || !events.length || index !== events.length - 1 || previewing || overlayId || document.hidden) return;
    stopRecall();
    stopIntro();
    if (api.isPlaying()) api.togglePlay();
    recalling = true;
    recallComplete = false;
    recall.hidden = false;
    recall.dataset.state = 'drawing';
    renderRecallText();
    restoreRecallView = api.fitJourney({ overview: true });
    $('recollection-close').focus({ preventScroll: true });
    const drawn = new Set();
    function drawRecord(event, position) {
      // Break at missing coordinates; never invent a bridge across an unresolved stop.
      let segment = [];
      const flush = () => {
        if (segment.length > 1) L.polyline(segment, {
          pane: 'journey-moments', interactive: false, color: '#b18c51',
          weight: 2.5, opacity: .65, className: 'moment-route',
        }).addTo(recallLayer);
        segment = [];
      };
      coordinatesOf(event).forEach(point => {
        if (!validPoint(point)) { flush(); return; }
        segment.push(latLng(point));
        const key = point.join(',');
        if (!drawn.has(key)) {
          drawn.add(key);
          addStar(recallLayer, point);
        }
      });
      flush();
      if (position === index) {
        if (validPoint(event.endCoords)) addStar(recallLayer, event.endCoords, true);
        recallComplete = true;
        recall.dataset.state = 'complete';
        renderRecallText();
      }
    }
    events.slice(0, index + 1).forEach((event, position) => {
      if (motion.matches) drawRecord(event, position);
      else later(recallTimers, () => drawRecord(event, position), 480 + position / Math.max(1, index) * 4800);
    });
  }
  document.addEventListener('journey:recall', startRecall);
  $('recollection-close').addEventListener('click', () => stopRecall(true));
  $('recollection-replay').addEventListener('click', () => {
    stopRecall();
    window.JourneyMap?.togglePlay();
    $('play-btn').focus({ preventScroll: true });
  });
  document.addEventListener('keydown', event => {
    if (recalling && event.key === 'Escape') {
      event.preventDefault();
      stopRecall(true);
    }
  });
  document.addEventListener('journey:overlay-change', event => {
    overlayId = event.detail.id;
    if (overlayId) stopRecall();
    if (overlayId && overlayId !== 'music-modal') stopIntro();
    else playIntro();
  });
  document.addEventListener('journey:music-change', event => {
    // A new selection gets a fresh opening, including a return to an earlier song.
    // Pause/resume and repeated media notifications retain the current selection.
    if (music.id !== event.detail.id) introShownForSelection = false;
    music = event.detail;
    playIntro();
  });
  document.addEventListener('journey:data-ready', event => {
    stopRecall();
    stopIntro();
    events = event.detail.events;
    index = window.JourneyMap.getCurrentIndex();
    renderKeepsakes(events[index]);
  });
  document.addEventListener('journey:event-change', event => {
    stopRecall();
    stopIntro();
    index = event.detail.index;
    renderKeepsakes(event.detail.event);
  });
  // Restore the normal camera limits before navigation computes its next view.
  document.addEventListener('journey:before-event-change', () => { stopRecall(); stopIntro(); });
  document.addEventListener('journey:event-preview', event => {
    stopRecall();
    stopIntro();
    renderKeepsakes(event.detail.event, true, false);
  });
  document.addEventListener('journey:locale-change', () => {
    renderKeepsakes(events[index], previewing, false);
    if (openPoem) renderPoem(openPoem);
    renderRecallText();
  });
  const clearEffects = () => { stopIntro(); stopRecall(); stamp.classList.remove('is-new'); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearEffects(); });
  motion.addEventListener('change', clearEffects);
  window.addEventListener('pagehide', clearEffects);
  window.addEventListener('resize', () => stopRecall());
  window.JourneyMoments = Object.freeze({
    attachMap(nextMap) {
      if (map) return;
      map = nextMap;
      const pane = map.createPane('journey-moments');
      pane.style.zIndex = '450';
      pane.style.pointerEvents = 'none';
      pane.setAttribute('aria-hidden', 'true');
      musicLayer = L.layerGroup().addTo(map);
      recallLayer = L.layerGroup().addTo(map);
      map.on('dragstart', clearEffects);
      map.getContainer().addEventListener('pointerdown', clearEffects);
      map.getContainer().addEventListener('wheel', clearEffects, { passive: true, capture: true });
      // Toolbar camera actions are outside the map container.
      document.querySelector('.map-tools').addEventListener('click', clearEffects, true);
    },
  });
})();
