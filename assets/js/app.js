/*!
 * 毛泽东生平地理轨迹可视化 - 主脚本文件
 * Author: sansan0
 * GitHub: https://github.com/sansan0/mao-map
 */

// ==================== i18n 国际化 ====================
/**
 * 初始化多语言支持
 */
async function initI18n() {
  try {
    // 获取首选语言
    const preferredLocale = i18n.getPreferredLocale();
    console.log('检测到首选语言:', preferredLocale);

    // setLocale 会按需加载语言包；失败交给统一的加载错误与重试界面。
    if (!await i18n.setLocale(preferredLocale)) {
      throw new Error('界面语言资料加载失败');
    }

    // 初始化语言切换按钮
    initLanguageSelector();

    console.log('i18n 初始化完成, 当前语言:', i18n.getCurrentLocale());
  } catch (error) {
    console.error('i18n 初始化失败:', error);
    throw error;
  }
}

/**
 * 初始化语言选择器
 */
function initLanguageSelector() {
  const langButtons = document.querySelectorAll('.lang-btn');
  let switching = false;
  langButtons.forEach(btn => {
    const lang = btn.getAttribute('data-lang');
    btn.classList.toggle('active', lang === i18n.getCurrentLocale());
    btn.setAttribute('aria-pressed', String(lang === i18n.getCurrentLocale()));
    btn.addEventListener('click', async () => {
      const selectedLang = btn.getAttribute('data-lang');
      if (switching || selectedLang === i18n.getCurrentLocale() || !trajectoryData) return;
      switching = true;
      langButtons.forEach(button => { button.disabled = true; });
      const previousLocale = i18n.getCurrentLocale();
      stopPlayback();
      cancelJourneyAnimation();
      hideDetailPanel();
      try {
        // 先准备资料，下载过程中保持现有语言和年表可用。
        const [localeLoaded, data] = await Promise.all([
          i18n.isLocaleLoaded(selectedLang) ? Promise.resolve(true) : i18n.loadLocale(selectedLang),
          loadTrajectoryData(selectedLang),
        ]);
        if (!localeLoaded) throw new Error('语言包加载失败');
        // 用户可能在等待期间另选了事件，以切换完成时的真实位置为准。
        const savedEventId = trajectoryData.events[currentEventIndex]?.id;
        stopPlayback();
        cancelJourneyAnimation();
        hideDetailPanel();
        if (!await i18n.setLocale(selectedLang)) throw new Error('语言包加载失败');
        trajectoryData = data;
        const restoredIndex = data.events.findIndex(event => event.id === savedEventId);
        currentEventIndex = restoredIndex >= 0 ? restoredIndex : 0;
        syncTimelineBounds();
        publishJourneyData();
        showEventAtIndex(currentEventIndex, false, true);
        updateStatistics();
      } catch (error) {
        console.error('重新加载事件数据失败:', error);
        if (i18n.getCurrentLocale() !== previousLocale) await i18n.setLocale(previousLocale);
        showTemporaryMessage(previousLocale === 'en' ? 'Unable to change language. Please try again.' : '语言切换未完成，请重试。', 'warning');
      } finally {
        switching = false;
        langButtons.forEach(button => {
          button.disabled = false;
          const active = button.dataset.lang === i18n.getCurrentLocale();
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', String(active));
        });
        updatePlaybackUI();
        updateAllSpeedUI();
      }
    });
  });
}

// ==================== 全局变量 ====================
let map = null;
let regionsData = null;
let trajectoryData = null;
let currentEventIndex = 0;
let previousEventIndex = 0;
let isPlaying = false;
let playInterval = null;
let eventMarkers = [];
let pathLayers = [];
let coordinateMap = new Map();
let locationGroups = new Map();
let locationMarkers = new Map();
let statsHoverTimeout = null;
let currentPlaySpeed = 1000;
let isPanelVisible = true;
let isFeedbackModalVisible = false;
let isCameraFollowEnabled = true;
let isDragging = false;

let isMusicModalVisible = false;
let currentMusicIndex = 0;
let isMusicPlaying = false;
let musicAudio = null;
let musicProgressInterval = null;
let musicVolume = 0.5;

// 添加音频状态管理变量
let audioLoadingPromise = null;
let isAutoPlayPending = false;
let currentAudioEventListeners = new Set();

let highlightedPaths = [];
let highlightTimeout = null;
let currentHighlightedEventIndex = -1;

let animationConfig = {
  pathDuration: 1200, // 路径绘制时长（由速度档位自动设置）
  timelineDuration: 1500, // 时间轴动画时长
  cameraFollowDuration: 800, // 镜头跟随动画时长（由速度档位自动设置）
  cameraPanDuration: 600, // 镜头平移动画时长（由速度档位自动设置）
  isAnimating: false,
  motionOptions: {
    auto: false, // 手动控制动画
    easing: L.Motion.Ease.easeInOutQuart,
  },
};

// 统一速度档位配置：用户只需选择一个速度，内部自动联动所有参数
const UNIFIED_SPEED_PRESETS = [
  {
    name: "ui.controls.speedOptions.veryFast",
    playInterval: 800,      // 事件间等待
    pathDuration: 600,      // 路径绘制时长
    cameraFollowDuration: 400, // 镜头 fitBounds 时长
    cameraPanDuration: 300,    // 镜头 setView 时长
  },
  {
    name: "ui.controls.speedOptions.fast",
    playInterval: 1500,
    pathDuration: 1200,
    cameraFollowDuration: 800,
    cameraPanDuration: 600,
  },
  {
    name: "ui.controls.speedOptions.normal",
    playInterval: 3000,
    pathDuration: 2500,
    cameraFollowDuration: 2000,
    cameraPanDuration: 1500,
  },
  {
    name: "ui.controls.speedOptions.slow",
    playInterval: 5000,
    pathDuration: 4000,
    cameraFollowDuration: 3500,
    cameraPanDuration: 2800,
  },
];

let currentSpeedLevel = 1; // 默认"快速"档
let pathSpeedMultiplier = 2.5; // 路径动画时长倍率 (1x-5x)，越大动画越慢

// 用户手动交互地图后暂停镜头跟随的计时器
let userInteractionTimeout = null;
let isUserInteracting = false;

// 镜头跟随模式: "smart"(智能) | "path"(沿路) | "off"(关闭)
let cameraFollowMode = "smart";
// 沿路跟随的缩放级别
let pathFollowZoom = 7;
// 沿路跟随动画帧 ID
let pathFollowAnimationId = null;

let motionPaths = new Map();
let animationQueue = [];
let isAnimationInProgress = false;
let routeScope = readStoredPreference("mao-map:route-scope") === "current" ? "current" : "all";
let mapTileLayer = null;
let mapTileErrors = 0;
let mapCameraIsProgrammatic = false;
let mapCameraTimeout = null;
let eventRenderVersion = 0;
let publicEvents = Object.freeze([]);
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function readStoredPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeStoredPreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch (error) {
    return false;
  }
}

// 按真实控件的范围和步长恢复，避免变量、滑块与显示值各自采用不同数值。
function normalizePreferenceNumber(value, fallback, min, max, step) {
  const number = value === null || String(value).trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.max(min, Math.min(max, number));
  return Number((min + Math.round((clamped - min) / step) * step).toFixed(6));
}

function prefersReducedMotion() {
  return reducedMotionQuery.matches;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function freezeSnapshot(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}

function publishJourneyData() {
  publicEvents = freezeSnapshot(JSON.parse(JSON.stringify(trajectoryData?.events || [])));
  document.dispatchEvent(new CustomEvent("journey:data-ready", { detail: { events: publicEvents } }));
}

function publishJourneyEvent() {
  const event = publicEvents[currentEventIndex] || freezeSnapshot(JSON.parse(JSON.stringify(trajectoryData.events[currentEventIndex])));
  document.dispatchEvent(new CustomEvent("journey:event-change", { detail: { index: currentEventIndex, event } }));
}

function syncTimelineBounds() {
  const events = trajectoryData?.events || [];
  const slider = document.getElementById("timeline-slider");
  if (slider) {
    slider.max = Math.max(0, events.length - 1);
    slider.disabled = !events.length;
  }
  document.querySelectorAll('[id^="total-event-count"]').forEach(element => {
    element.textContent = events.length;
  });
}

function setMapStatus(message = "", retry = null) {
  let status = document.getElementById("map-status");
  if (!status) {
    status = document.createElement("div");
    status.id = "map-status";
    status.className = "map-status";
    status.setAttribute("role", "status");
    (document.querySelector(".map-stage") || document.getElementById("container")).appendChild(status);
  }
  status.replaceChildren();
  status.hidden = !message;
  if (!message) return;
  const text = document.createElement("span");
  text.textContent = message;
  status.appendChild(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = i18n.getCurrentLocale() === "en" ? "Retry" : "重试";
    button.addEventListener("click", retry);
    status.appendChild(button);
  }
}

function withProgrammaticCamera(action, duration = 0) {
  clearTimeout(mapCameraTimeout);
  mapCameraIsProgrammatic = true;
  action();
  mapCameraTimeout = setTimeout(() => { mapCameraIsProgrammatic = false; }, duration + 150);
}

function cancelJourneyAnimation() {
  eventRenderVersion += 1;
  if (animationConfig._lockTimer) clearTimeout(animationConfig._lockTimer);
  animationConfig._lockTimer = null;
  animationConfig.isAnimating = false;
  stopPathFollowCamera();
  quickClearPathHighlight();
  if (map) map.stop();
}

function goToJourneyEvent(index) {
  const target = Number(index);
  if (!Number.isInteger(target) || !trajectoryData?.events[target]) return false;
  stopPlayback();
  cancelJourneyAnimation();
  isUserInteracting = false;
  clearTimeout(userInteractionTimeout);
  showEventAtIndex(target, false, true);
  return true;
}

function getJourneyMapPadding() {
  const padding = { paddingTopLeft: [40, 40], paddingBottomRight: [40, 40] };
  if (!map) return padding;
  const mapRect = map.getContainer().getBoundingClientRect();
  const validRect = (rect) => rect &&
    [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0 && rect.right > rect.left && rect.bottom > rect.top;
  if (!validRect(mapRect)) return padding;
  padding.paddingTopLeft = [Math.min(40, mapRect.width / 4), Math.min(40, mapRect.height / 4)];
  padding.paddingBottomRight = [...padding.paddingTopLeft];

  if (document.body.dataset.viewMode === "browse") {
    const stage = document.getElementById("map-stage");
    if (!stage || stage.hidden) return padding;
    const stageStyle = getComputedStyle(stage);
    if (stageStyle.display === "none" || stageStyle.visibility === "hidden") return padding;
    const stageRect = stage.getBoundingClientRect();
    if (!validRect(stageRect)) return padding;
    const left = Math.max(mapRect.left, stageRect.left);
    const top = Math.max(mapRect.top, stageRect.top);
    const right = Math.min(mapRect.right, stageRect.right);
    const bottom = Math.min(mapRect.bottom, stageRect.bottom);
    if (right <= left || bottom <= top) return padding;

    // 底图铺满页面；网格中的地图区域界定年表、顶栏和底部资料之外的取景空间。
    const insetX = Math.min(40, (right - left) / 4);
    const insetY = Math.min(40, (bottom - top) / 4);
    padding.paddingTopLeft = [left - mapRect.left + insetX, top - mapRect.top + insetY];
    padding.paddingBottomRight = [mapRect.right - right + insetX, mapRect.bottom - bottom + insetY];
    return padding;
  }

  const dock = document.getElementById("playback-dock");
  if (!dock || dock.hidden) return padding;
  const dockStyle = getComputedStyle(dock);
  if (dockStyle.display === "none" || dockStyle.visibility === "hidden") return padding;
  const dockRect = dock.getBoundingClientRect();
  if (!validRect(dockRect)) return padding;
  const overlapsHorizontally = Math.min(mapRect.right, dockRect.right) > Math.max(mapRect.left, dockRect.left);
  const overlapsVertically = Math.min(mapRect.bottom, dockRect.bottom) > Math.max(mapRect.top, dockRect.top);
  if (!overlapsHorizontally || !overlapsVertically) return padding;

  // 连同浮动底栏下方的空隙一起留出；狭窄横屏下仍保留有效的地图计算区域。
  const coveredHeight = Math.min(mapRect.bottom - Math.max(mapRect.top, dockRect.top), Math.max(0, mapRect.height - 48));
  const verticalInset = Math.min(40, (mapRect.height - coveredHeight) / 4);
  padding.paddingTopLeft[1] = verticalInset;
  padding.paddingBottomRight[1] = coveredHeight + verticalInset;
  return padding;
}

function getJourneyCameraCenter(latLng, zoom = map.getZoom()) {
  const { paddingTopLeft, paddingBottomRight } = getJourneyMapPadding();
  const offset = L.point(
    (paddingBottomRight[0] - paddingTopLeft[0]) / 2,
    (paddingBottomRight[1] - paddingTopLeft[1]) / 2
  );
  return map.unproject(map.project(latLng, zoom).add(offset), zoom);
}

function isJourneyPointVisible(latLng) {
  const { paddingTopLeft, paddingBottomRight } = getJourneyMapPadding();
  const point = map.latLngToContainerPoint(latLng);
  const size = map.getSize();
  return point.x >= paddingTopLeft[0] && point.x <= size.x - paddingBottomRight[0] &&
    point.y >= paddingTopLeft[1] && point.y <= size.y - paddingBottomRight[1];
}

function focusCurrentEvent() {
  if (!map || !trajectoryData?.events[currentEventIndex]) return;
  isUserInteracting = false;
  clearTimeout(userInteractionTimeout);
  stopPathFollowCamera();
  map.stop();
  const bounds = calculatePathBounds(trajectoryData.events[currentEventIndex]);
  if (bounds?.isValid()) {
    withProgrammaticCamera(() => map.fitBounds(bounds, {
      ...getJourneyMapPadding(), maxZoom: 8, animate: !prefersReducedMotion(), duration: 0.45,
    }), 450);
  }
}

function fitJourney({ overview = false } = {}) {
  if (!map || !trajectoryData) return;
  stopPathFollowCamera();
  map.stop();
  const coordinates = trajectoryData.events.slice(0, currentEventIndex + 1)
    .flatMap((event) => [event.startCoords, ...event.transitCoords, event.endCoords])
    .filter(Boolean).map(([lng, lat]) => [lat, lng]);
  if (!coordinates.length) return;
  let restoreView;
  if (overview && mapTileLayer) {
    const savedView = { center: map.getCenter(), zoom: map.getZoom(), minZoom: map.getMinZoom() };
    const tileOptions = { minZoom: mapTileLayer.options.minZoom, minNativeZoom: mapTileLayer.options.minNativeZoom };
    // Small screens need a wider view to include international visits. Reuse z=4
    // tiles at that scale: the legacy provider returns blank low-zoom images.
    mapTileLayer.options.minZoom = 1;
    mapTileLayer.options.minNativeZoom = tileOptions.minNativeZoom ?? tileOptions.minZoom;
    map.setMinZoom(1);
    restoreView = () => {
      Object.assign(mapTileLayer.options, tileOptions);
      withProgrammaticCamera(() => {
        map.stop();
        map.setView(savedView.center, savedView.zoom, { animate: false });
        map.setMinZoom(savedView.minZoom);
      }, 0);
    };
  }
  isUserInteracting = true;
  clearTimeout(userInteractionTimeout);
  userInteractionTimeout = setTimeout(() => { isUserInteracting = false; }, 4000);
  withProgrammaticCamera(() => map.fitBounds(L.latLngBounds(coordinates), {
    ...getJourneyMapPadding(), maxZoom: 8, animate: !prefersReducedMotion(), duration: 0.45,
  }), 450);
  return restoreView;
}

function setRouteScope(scope) {
  if (scope !== "all" && scope !== "current") return false;
  routeScope = scope;
  writeStoredPreference("mao-map:route-scope", routeScope);
  cancelJourneyAnimation();
  if (trajectoryData) {
    updatePathsStatic(currentEventIndex);
    updateEventMarkers(currentEventIndex);
  }
  return true;
}

function openCurrentPlaceArchive() {
  const coordinates = trajectoryData?.events[currentEventIndex]?.endCoords;
  if (!coordinates) return false;
  // A keepsake always opens the archive up to this date, including in single-route view.
  const group = groupEventsByLocation(trajectoryData.events, currentEventIndex).get(coordinates.join(','));
  if (!group) return false;
  showDetailPanel(group);
  return true;
}

window.JourneyMap = Object.freeze({
  getEvents: () => publicEvents,
  getCurrentIndex: () => currentEventIndex,
  goTo: goToJourneyEvent,
  isPlaying: () => isPlaying,
  togglePlay,
  focusCurrent: focusCurrentEvent,
  fitJourney,
  setRouteScope,
  getRouteScope: () => routeScope,
  refreshAppearance,
  copyCurrentEventData,
  openCurrentPlaceArchive,
});

reducedMotionQuery.addEventListener?.("change", () => {
  if (prefersReducedMotion() && trajectoryData) {
    cancelJourneyAnimation();
    updatePathsStatic(currentEventIndex);
    scheduleNextPlayback();
  }
});

// ==================== 全局常量 ====================
const INTERNATIONAL_COORDINATES = {
  "俄罗斯 莫斯科": [37.6176, 55.7558],
};

/**
 * 检测是否为移动设备
 */
// ==================== 移动端交互 ====================
/**
 * 切换控制面板显示/隐藏状态
 */
function toggleControlPanel() {
  const panel = document.getElementById("timeline-control");
  const toggleBtn = document.getElementById("toggle-panel-btn");
  const mapEl = document.getElementById("map");
  if (!panel || !toggleBtn || !mapEl) return;

  if (isPanelVisible) {
    panel.classList.add("hidden");
    toggleBtn.innerHTML = window.JourneyIcons.svg('chevron-up');
    mapEl.classList.remove("panel-visible");
    mapEl.classList.add("panel-hidden");
    isPanelVisible = false;
  } else {
    panel.classList.remove("hidden");
    toggleBtn.innerHTML = window.JourneyIcons.svg('chevron-down');
    mapEl.classList.remove("panel-hidden");
    mapEl.classList.add("panel-visible");
    isPanelVisible = true;
  }

  setTimeout(() => {
    if (map && map.invalidateSize) {
      map.invalidateSize({
        animate: true,
        pan: false,
      });
    }
  }, 350);
}

/**
 * 获取控制面板高度
 */
function getControlPanelHeight() {
  const panel = document.getElementById("timeline-control");
  if (!panel || panel.classList.contains("hidden")) {
    return 0;
  }

  const rect = panel.getBoundingClientRect();
  return rect.height;
}

/**
 * 初始化移动端交互功能
 */
function initMobileInteractions() {
  const toggleBtn = document.getElementById("toggle-panel-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleControlPanel);
  }

  initPanelDragClose();
}

/**
 * 初始化详细面板拖拽关闭功能（移动端）
 */
function initPanelDragClose() {
  if (!isMobileDevice()) return;
  if (window.cleanupDragListeners) window.cleanupDragListeners();

  const panel = document.getElementById("location-detail-panel");
  const panelHeader = panel?.querySelector(".panel-header");
  const backdrop = document.getElementById("panel-backdrop");

  if (!panel || !panelHeader) return;

  let touchState = {
    startY: 0,
    currentY: 0,
    deltaY: 0,
    startTime: 0,
    isDragging: false,
    hasMoved: false,
    isProcessing: false,
  };

  function resetAllStates(isClosing = false) {
    touchState = {
      startY: 0,
      currentY: 0,
      deltaY: 0,
      startTime: 0,
      isDragging: false,
      hasMoved: false,
      isProcessing: false,
    };

    panel.classList.remove("dragging");
    panelHeader.classList.remove("dragging");

    if (!isClosing) {
      panel.style.transform = "translateY(0)";
      panel.style.transition =
        "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)";

      if (backdrop) {
        backdrop.style.opacity = "0.3";
        backdrop.style.transition = "opacity 0.3s ease";
      }

      if (!panel.classList.contains("visible")) {
        panel.classList.add("visible");
      }

      setTimeout(() => {
        if (panel.style.transition.includes("transform")) {
          panel.style.transition = "";
        }
        if (backdrop && backdrop.style.transition.includes("opacity")) {
          backdrop.style.transition = "";
        }
      }, 350);
    }
  }

  function safeClosePanel() {
    touchState.isProcessing = true;

    panel.style.transform = "translateY(100%)";
    panel.style.transition =
      "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)";

    if (backdrop) {
      backdrop.style.opacity = "0";
      backdrop.style.transition = "opacity 0.3s ease";
    }

    setTimeout(() => {
      try {
        hideDetailPanel();
      } catch (error) {
        console.error("关闭面板时出错:", error);
      }

      setTimeout(() => {
        resetAllStates(true);
      }, 100);
    }, 300);
  }

  function handleTouchStart(e) {
    if (touchState.isProcessing) {
      return;
    }

    if (
      e.target.closest(".panel-close") ||
      e.target.closest(".panel-content")
    ) {
      return;
    }

    const touch = e.touches[0];
    touchState.startY = touch.clientY;
    touchState.currentY = touch.clientY;
    touchState.startTime = Date.now();
    touchState.isDragging = true;
    touchState.hasMoved = false;
    touchState.deltaY = 0;

    panel.classList.add("dragging");
    panelHeader.classList.add("dragging");

    panel.style.transition = "none";
    if (backdrop) {
      backdrop.style.transition = "none";
    }

    e.preventDefault();
  }

  function handleTouchMove(e) {
    if (!touchState.isDragging || touchState.isProcessing) {
      return;
    }

    const touch = e.touches[0];
    touchState.currentY = touch.clientY;
    touchState.deltaY = touchState.currentY - touchState.startY;

    if (!touchState.hasMoved && Math.abs(touchState.deltaY) > 3) {
      touchState.hasMoved = true;
    }

    if (touchState.deltaY > 0) {
      const maxDrag = 250;
      const dampingFactor = Math.max(
        0.3,
        1 - (touchState.deltaY / maxDrag) * 0.7
      );
      const transformValue = Math.min(
        touchState.deltaY * dampingFactor,
        maxDrag
      );

      panel.style.transform = `translateY(${transformValue}px)`;

      if (backdrop) {
        const maxOpacity = 0.3;
        const opacityReduction = (touchState.deltaY / 200) * maxOpacity;
        const newOpacity = Math.max(0.05, maxOpacity - opacityReduction);
        backdrop.style.opacity = newOpacity.toString();
      }
    } else {
      panel.style.transform = "translateY(0)";
      if (backdrop) {
        backdrop.style.opacity = "0.3";
      }
    }

    e.preventDefault();
  }

  function handleTouchEnd(e) {
    if (!touchState.isDragging) {
      return;
    }

    const duration = Date.now() - touchState.startTime;
    const velocity = duration > 0 ? Math.abs(touchState.deltaY) / duration : 0;

    panel.classList.remove("dragging");
    panelHeader.classList.remove("dragging");

    panel.style.transition =
      "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
    if (backdrop) {
      backdrop.style.transition = "opacity 0.3s ease";
    }

    const shouldClose =
      touchState.hasMoved &&
      (touchState.deltaY > 40 ||
        (touchState.deltaY > 20 && velocity > 0.2) ||
        (touchState.deltaY > 10 && velocity > 0.5));

    if (shouldClose) {
      safeClosePanel();
    } else {
      resetAllStates(false);
    }
  }

  function handleTouchCancel(e) {
    if (touchState.isDragging && !touchState.isProcessing) {
      resetAllStates();
    }
  }

  function cleanupEventListeners() {
    panelHeader.removeEventListener("touchstart", handleTouchStart);
    panelHeader.removeEventListener("touchmove", handleTouchMove);
    panelHeader.removeEventListener("touchend", handleTouchEnd);
    panelHeader.removeEventListener("touchcancel", handleTouchCancel);
  }

  function bindEventListeners() {
    panelHeader.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });

    panelHeader.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });

    panelHeader.addEventListener("touchend", handleTouchEnd, {
      passive: false,
    });

    panelHeader.addEventListener("touchcancel", handleTouchCancel, {
      passive: false,
    });
  }

  cleanupEventListeners();
  bindEventListeners();

  const panelContent = panel.querySelector(".panel-content");
  if (panelContent && !panelContent.dataset.dragContentBound) {
    panelContent.dataset.dragContentBound = "true";
    panelContent.addEventListener(
      "touchstart",
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    panelContent.addEventListener(
      "touchmove",
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );
  }

  window.cleanupDragListeners = cleanupEventListeners;
}

/**
 * 初始化Leaflet地图
 */
function initMap() {
  // This legacy raster endpoint returns a blank image at z=2. Keep the
  // original overview limit in sync for the map and its base tile layer.
  const minBaseMapZoom = 4;
  map = L.map("map", {
    center: [35.8617, 104.1954],
    zoom: 5,
    minZoom: minBaseMapZoom,
    maxZoom: 10,
    zoomControl: false,
    attributionControl: false,
    tap: true,
    tapTolerance: 15,
  });
  const zoomIn = document.getElementById('zoom-in');
  const zoomOut = document.getElementById('zoom-out');
  const syncZoomControls = () => {
    zoomIn.disabled = map.getZoom() >= map.getMaxZoom();
    zoomOut.disabled = map.getZoom() <= map.getMinZoom();
    for (const button of [zoomIn, zoomOut]) button.setAttribute('aria-disabled', String(button.disabled));
  };
  const zoomBy = (delta) => {
    const options = { animate: !prefersReducedMotion() };
    if (document.body.dataset.viewMode === 'browse') {
      const { paddingTopLeft, paddingBottomRight } = getJourneyMapPadding();
      const size = map.getSize();
      const center = L.point(
        (paddingTopLeft[0] + size.x - paddingBottomRight[0]) / 2,
        (paddingTopLeft[1] + size.y - paddingBottomRight[1]) / 2
      );
      const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta));
      map.setZoomAround(center, zoom, options);
    } else if (delta > 0) {
      map.zoomIn(delta, options);
    } else {
      map.zoomOut(-delta, options);
    }
  };
  zoomIn.addEventListener('click', event => {
    if (!zoomIn.disabled) zoomBy(event.shiftKey ? 3 : 1);
  });
  zoomOut.addEventListener('click', event => {
    if (!zoomOut.disabled) zoomBy(event.shiftKey ? -3 : -1);
  });
  map.on('zoomend zoomlevelschange', syncZoomControls);
  syncZoomControls();

  mapTileLayer = L.tileLayer(
    "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
    {
      subdomains: "1234",
      attribution: "© 高德地图",
      minZoom: minBaseMapZoom,
      maxZoom: 18,
    }
  ).addTo(map);

  mapTileLayer.on("tileerror", () => { mapTileErrors += 1; });
  mapTileLayer.on("load", () => {
    if (mapTileErrors > 0) {
      setMapStatus(i18n.getCurrentLocale() === "en"
        ? "Some map tiles could not load. The timeline remains available."
        : "部分底图未能加载，仍可浏览年表和足迹。", retryMapTiles);
    } else {
      setMapStatus();
    }
  });
  mapTileLayer.on("loading", () => { mapTileErrors = 0; });

  window.JourneyMoments?.attachMap(map);
  console.log("地图初始化完成");
}

function retryMapTiles() {
  if (!mapTileLayer) return;
  mapTileErrors = 0;
  setMapStatus(i18n.getCurrentLocale() === "en" ? "Reloading map…" : "正在重新加载底图…");
  mapTileLayer.redraw();
}

// ==================== 统计面板控制 ====================
/**
 * 初始化PC端统计面板悬停交互
 */
/**
 * 初始化设置面板（右下角）
 */
function initSettingsPanel() {
  const settingsBtn = document.getElementById("settings-btn");
  const settingsPanel = document.getElementById("settings-panel");
  const closeBtn = document.getElementById("settings-panel-close");

  if (!settingsBtn || !settingsPanel) return;

  function toggleSettings() {
    const isVisible = settingsPanel.classList.contains("visible");
    if (isVisible) {
      settingsPanel.classList.remove("visible");
      settingsBtn.classList.remove("active");
    } else {
      settingsPanel.classList.add("visible");
      settingsBtn.classList.add("active");
    }
    settingsBtn.setAttribute("aria-expanded", String(!isVisible));
  }

  settingsBtn.addEventListener("click", toggleSettings);
  if (closeBtn) closeBtn.addEventListener("click", toggleSettings);

  // 点击外部关闭
  document.addEventListener("click", (e) => {
    if (settingsPanel.classList.contains("visible") &&
        !settingsPanel.contains(e.target) &&
        !settingsBtn.contains(e.target)) {
      settingsPanel.classList.remove("visible");
      settingsBtn.classList.remove("active");
      settingsBtn.setAttribute("aria-expanded", "false");
    }
  });

  // 初始化跟随模式选择器
  initFollowModeSelector();

  // 初始化跟随缩放滑块
  initFollowZoomSlider();

  // 初始化路径动画时长倍率
  initPathSpeedMultiplier();
}

// 兼容旧调用
function initStatsHover() {
  initSettingsPanel();
}

// ==================== 详细信息面板控制 ====================
/**
 * 初始化详细信息面板交互
 */
function initDetailPanel() {
  const panel = document.getElementById("location-detail-panel");
  const backdrop = document.getElementById("panel-backdrop");
  const closeBtn = document.getElementById("panel-close-btn");

  if (closeBtn) {
    closeBtn.addEventListener("click", hideDetailPanel);
  }

  if (backdrop) {
    backdrop.addEventListener("click", hideDetailPanel);
  }

  if (panel) {
    panel.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  if (!isMobileDevice()) {
    document.addEventListener("click", (e) => {
      if (panel && panel.classList.contains("visible")) {
        const isClickInsidePanel = panel.contains(e.target);
        const isClickOnMarker = e.target.closest(".leaflet-marker-icon");

        if (!isClickInsidePanel && !isClickOnMarker) {
          hideDetailPanel();
        }
      }
    });
  }
}

/**
 * 显示地点详细信息面板
 */
function showDetailPanel(locationGroup) {
  const panel = document.getElementById("location-detail-panel");
  const backdrop = document.getElementById("panel-backdrop");
  const titleEl = document.getElementById("panel-location-title");
  const summaryEl = document.getElementById("panel-visit-summary");
  const contentEl = document.getElementById("panel-content");

  if (!panel || !titleEl || !summaryEl || !contentEl) return;

  const { location, events } = locationGroup;
  const visitCount = events.length;

  titleEl.textContent = location;

  // 使用国际化的摘要文本
  const summaryText = i18n.getCurrentLocale() === "en"
    ? `${visitCount} related events up to this date`
    : `截至当前时间点 · ${visitCount} 条相关事件`;

  summaryEl.replaceChildren();
  const count = document.createElement('strong');
  count.className = 'visit-count-highlight';
  count.textContent = visitCount;
  const parts = summaryText.split(String(visitCount));
  summaryEl.append(parts[0], count, parts.slice(1).join(String(visitCount)));

  const sortedEvents = [...events].sort((a, b) => a.index - b.index);

  const eventListHtml = sortedEvents
    .map((event, index) => {
      const isCurrentEvent = event.index === currentEventIndex;
      const itemClass = isCurrentEvent
        ? "event-item current-event"
        : "event-item";

      let visitTypeClass = "";
      let visitTypeLabel = "";
      let visitOrderClass = "";

      // 使用国际化的顺序编号
      const orderNumber = i18n.t('ui.panel.orderNumber', { n: index + 1 });

      // 根据访问类型获取对应的国际化标签
      const birthLabel = i18n.t('ui.visitType.birth');
      const startLabel = i18n.t('ui.visitType.start');
      const destinationLabel = i18n.t('ui.visitType.destination');
      const transitLabel = i18n.t('ui.visitType.transit');
      const activityLabel = i18n.t('ui.visitType.activity');

      if (event.visitType === birthLabel) {
        visitTypeClass = "birth-event";
        visitTypeLabel = birthLabel;
        visitOrderClass = "birth-order";
      } else if (event.visitType === startLabel) {
        visitTypeClass = "start-event";
        visitTypeLabel = startLabel;
        visitOrderClass = "start-order";
      } else if (event.visitType === destinationLabel) {
        visitTypeLabel = destinationLabel;
        visitOrderClass = "";
      } else if (event.visitType === transitLabel) {
        visitTypeClass = "transit-event";
        visitTypeLabel = transitLabel;
        visitOrderClass = "transit-order";
      } else if (event.visitType === activityLabel) {
        visitTypeClass = "activity-event";
        visitTypeLabel = activityLabel;
        visitOrderClass = "activity-order";
      }

      // 处理事件描述，如果是途径类型，添加国际化的前缀
      let eventDescription = event.originalEvent || event.event;
      if (event.visitType === transitLabel && event.originalEvent) {
        const transitPrefix = i18n.t('ui.panel.transitPrefix');
        eventDescription = transitPrefix + event.originalEvent;
      }

      // 使用国际化的年龄显示
      const ageDisplay = Number.isFinite(event.age)
        ? `<span class="event-age">${escapeHtml(i18n.t('ui.panel.eventAge', { age: event.age }))}</span>`
        : "";

      return `
      <div class="${itemClass} ${visitTypeClass}" data-event-index="${
        event.index
      }">
        <button class="event-select" type="button" data-event-index="${event.index}" aria-current="${isCurrentEvent ? 'step' : 'false'}">
        <span class="event-header">
          <span class="visit-order-number">${orderNumber}</span>
          <span class="event-date-item">${escapeHtml(event.date)}</span>
          <span class="visit-order ${visitOrderClass}">${escapeHtml(visitTypeLabel)}</span>
        </span>
        <span class="event-description">${escapeHtml(eventDescription)}</span>
        ${ageDisplay}
        </button>
        ${renderEventSource(event)}
      </div>
    `;
    })
    .join("");

  contentEl.innerHTML = eventListHtml;
  contentEl.querySelectorAll('.event-source a').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      openExternalUrl(link.href);
    });
  });

  const eventItems = contentEl.querySelectorAll(".event-select");
  eventItems.forEach((item) => {
    const eventIndex = parseInt(item.dataset.eventIndex);

    item.addEventListener("click", (e) => {
      e.stopPropagation();

      goToJourneyEvent(eventIndex);
      hideDetailPanel();
    });
  });

  if (backdrop) {
    backdrop.classList.add("visible");
  }

  panel.classList.add("visible");

  if (isMobileDevice()) {
    setTimeout(() => {
      initPanelDragClose();
    }, 100);
  }
}

function renderEventSource(event) {
  if (!event.verification) return "";
  const source = String(event.verification);
  const url = source.match(/https?:\/\/[^\s<>"']+/)?.[0];
  const sourceHtml = url
    ? `${escapeHtml(source.replace(url, '').trim())} <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${i18n.getCurrentLocale() === "en" ? "Open source" : "查看原文"} ${window.JourneyIcons.svg('arrow-up-right')}</a>`
    : escapeHtml(source);
  return `<details class="event-source"><summary>${i18n.getCurrentLocale() === "en" ? "Source notes" : "资料与出处"}</summary><p>${sourceHtml}</p></details>`;
}

/**
 * 隐藏详细信息面板
 */
function hideDetailPanel() {
  const panel = document.getElementById("location-detail-panel");
  const backdrop = document.getElementById("panel-backdrop");

  if (panel) {
    panel.classList.remove("visible", "dragging");
    panel.style.transform = "";
    panel.style.transition = "";
  }

  if (backdrop) {
    backdrop.classList.remove("visible", "dragging");
    backdrop.style.opacity = "";
    backdrop.style.transition = "";
  }

  if (window.cleanupDragListeners) {
    try {
      window.cleanupDragListeners();
    } catch (error) {
      console.warn("清理拖拽监听器时出错:", error);
    }
  }
}

// ==================== 反馈功能控制 ====================
/**
 * 初始化反馈功能
 */
function initFeedbackModal() {
  const feedbackBtn = document.getElementById("feedback-btn");
  const feedbackModal = document.getElementById("feedback-modal");
  const feedbackBackdrop = document.getElementById("feedback-backdrop");
  const feedbackClose = document.getElementById("feedback-modal-close");

  if (feedbackBtn) {
    feedbackBtn.addEventListener("click", showFeedbackModal);
  }

  if (feedbackClose) {
    feedbackClose.addEventListener("click", hideFeedbackModal);
  }

  if (feedbackBackdrop) {
    feedbackBackdrop.addEventListener("click", hideFeedbackModal);
  }

  if (feedbackModal) {
    feedbackModal.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  const issuesItem = document.getElementById("feedback-issues");
  const projectItem = document.getElementById("feedback-project");
  const wechatItem = document.getElementById("feedback-wechat");

  if (issuesItem) {
    issuesItem.addEventListener("click", () => {
      openGitHubIssues();
      hideFeedbackModal();
    });
  }

  if (projectItem) {
    projectItem.addEventListener("click", () => {
      openGitHubProject();
      hideFeedbackModal();
    });
  }

  if (wechatItem) {
    wechatItem.addEventListener("click", () => {
      handleWeChatAction();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isFeedbackModalVisible) {
      hideFeedbackModal();
    }
  });

  initWeChatQRModal();
}

/**
 * 显示反馈弹窗
 */
function showFeedbackModal() {
  const feedbackModal = document.getElementById("feedback-modal");
  const feedbackBackdrop = document.getElementById("feedback-backdrop");

  if (feedbackModal && feedbackBackdrop) {
    feedbackBackdrop.classList.add("visible");
    feedbackModal.classList.add("visible");
    isFeedbackModalVisible = true;

    document.body.style.overflow = "hidden";
  }
}

/**
 * 隐藏反馈弹窗
 */
function hideFeedbackModal() {
  const feedbackModal = document.getElementById("feedback-modal");
  const feedbackBackdrop = document.getElementById("feedback-backdrop");

  if (feedbackModal && feedbackBackdrop) {
    feedbackBackdrop.classList.remove("visible");
    feedbackModal.classList.remove("visible");
    isFeedbackModalVisible = false;

    document.body.style.overflow = "";
  }
}

/**
 * 打开GitHub Issues页面
 */
function openExternalUrl(url) {
  if (window.__TAURI_INTERNALS__) {
    window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: url }).catch(function () {
      window.open(url, "_blank", "noopener,noreferrer");
    });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function openGitHubIssues() {
  openExternalUrl("https://github.com/sansan0/mao-map/issues");
}

/**
 * 打开GitHub项目主页
 */
function openGitHubProject() {
  openExternalUrl("https://github.com/sansan0/mao-map");
}

/**
 * 检测是否为移动设备
 */
function isMobileDevice() {
  return window.matchMedia("(max-width: 900px)").matches || window.innerHeight <= 560 ||
    (Boolean(window.__TAURI_INTERNALS__) && /android/i.test(navigator.userAgent));
}

/**
 * 处理微信公众号操作（移动端复制，PC端显示二维码）
 */
function handleWeChatAction() {
  hideFeedbackModal();

  if (isMobileDevice()) {
    copyWeChatName();
  } else {
    showWeChatQRModal();
  }
}

/**
 * 复制微信公众号名称
 */
function copyWeChatName() {
  const wechatName = i18n.t('messages.wechatName');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(wechatName)
      .then(() => {
        showTemporaryMessage(
          i18n.t('messages.wechatCopied', { name: wechatName }),
          "success"
        );
      })
      .catch(() => {
        showTemporaryMessage(i18n.t('messages.wechatSearch', { name: wechatName }), "info");
      });
  } else {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = wechatName;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.select();
      textArea.setSelectionRange(0, 99999);
      document.execCommand("copy");
      document.body.removeChild(textArea);
      showTemporaryMessage(
        i18n.t('messages.wechatCopied', { name: wechatName }),
        "success"
      );
    } catch (err) {
      showTemporaryMessage(i18n.t('messages.wechatSearch', { name: wechatName }), "info");
    }
  }
}

/**
 * 显示微信二维码弹窗
 */
function showWeChatQRModal() {
  const modal = document.getElementById("wechat-qr-modal");
  const backdrop = document.getElementById("wechat-qr-backdrop");

  if (modal && backdrop) {
    backdrop.classList.add("visible");
    modal.classList.add("visible");
    document.body.style.overflow = "hidden";
  }
}

/**
 * 隐藏微信二维码弹窗
 */
function hideWeChatQRModal() {
  const modal = document.getElementById("wechat-qr-modal");
  const backdrop = document.getElementById("wechat-qr-backdrop");

  if (modal && backdrop) {
    backdrop.classList.remove("visible");
    modal.classList.remove("visible");
    document.body.style.overflow = "";
  }
}

/**
 * 初始化微信二维码弹窗
 */
function initWeChatQRModal() {
  const backdrop = document.getElementById("wechat-qr-backdrop");
  const closeBtn = document.getElementById("wechat-qr-close");
  const modal = document.getElementById("wechat-qr-modal");

  if (backdrop) {
    backdrop.addEventListener("click", hideWeChatQRModal);
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", hideWeChatQRModal);
  }

  if (modal) {
    modal.addEventListener("click", (e) => e.stopPropagation());
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modal = document.getElementById("wechat-qr-modal");
      if (modal && modal.classList.contains("visible")) {
        hideWeChatQRModal();
      }
    }
  });
}

/**
 * 显示临时提示消息
 */
function showTemporaryMessage(message, type = "info") {
  const existingMessage = document.querySelector(".temp-message");
  if (existingMessage) {
    existingMessage.remove();
  }

  const messageDiv = document.createElement("div");
  messageDiv.className = "temp-message";
  messageDiv.textContent = message;
  messageDiv.setAttribute("role", "status");

  const colors = {
    success: { bg: "rgba(39, 174, 96, 0.9)", border: "#27ae60" },
    info: { bg: "rgba(52, 152, 219, 0.9)", border: "#3498db" },
    warning: { bg: "rgba(243, 156, 18, 0.9)", border: "#f39c12" },
  };

  const color = colors[type] || colors.info;

  Object.assign(messageDiv.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: color.bg,
    color: "white",
    padding: "12px 20px",
    borderRadius: "8px",
    border: `1px solid ${color.border}`,
    zIndex: "9999",
    fontSize: "14px",
    fontWeight: "500",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    backdropFilter: "blur(10px)",
    maxWidth: "90vw",
    textAlign: "center",
    lineHeight: "1.4",
  });

  document.body.appendChild(messageDiv);

  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.style.opacity = "0";
      if (!prefersReducedMotion()) {
        messageDiv.style.transform = "translate(-50%, -50%) scale(0.9)";
        messageDiv.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      }

      setTimeout(() => {
        if (messageDiv.parentNode) {
          messageDiv.remove();
        }
      }, 300);
    }
  }, 3000);
}

// ==================== 坐标数据处理 ====================
/**
 * 从地区数据构建坐标映射表
 */
function buildCoordinateMapFromRegions() {
  console.log("建立坐标映射...");

  if (regionsData && regionsData.regions) {
    regionsData.regions.forEach((region) => {
      const extPath = region.ext_path;
      const coordinates = region.coordinates;

      if (
        extPath &&
        coordinates &&
        Array.isArray(coordinates) &&
        coordinates.length === 2
      ) {
        coordinateMap.set(extPath, coordinates);
      }
    });
  }

  Object.entries(INTERNATIONAL_COORDINATES).forEach(([name, coords]) => {
    coordinateMap.set(name, coords);
  });

  console.log("坐标映射建立完成，共", coordinateMap.size, "个地点");
  console.log("国际坐标:", Object.keys(INTERNATIONAL_COORDINATES));
}

// ==================== 数据加载 ====================
/**
 * 加载地理坐标数据
 */
async function loadGeographicData() {
  try {
    const response = await fetch("data/china_regions_coordinates.json");

    if (response.ok) {
      regionsData = await response.json();
      buildCoordinateMapFromRegions();
      console.log("china_regions_coordinates.json 加载成功");
    } else {
      throw new Error("china_regions_coordinates.json 加载失败");
    }

    return true;
  } catch (error) {
    console.warn("外部地理数据加载失败:", error.message);
    return false;
  }
}

/**
 * 加载轨迹事件数据
 * 英文版本使用英文事件描述，但坐标信息从中文数据获取（因为坐标映射基于中文地名）
 */
async function loadTrajectoryData(locale = i18n.getCurrentLocale()) {
  try {
    const isEnglish = locale === 'en';

    // 始终加载中文数据（用于坐标匹配）
    const zhResponse = await fetch('data/mao_trajectory_events.json');
    if (!zhResponse.ok) {
      throw new Error(
        `加载中文事件数据失败: ${zhResponse.status} - ${zhResponse.statusText}`
      );
    }
    const zhData = await zhResponse.json();

    if (
      !zhData.events ||
      !Array.isArray(zhData.events) ||
      zhData.events.length === 0
    ) {
      throw new Error("中文事件数据格式错误或为空");
    }

    // 如果是英文，加载英文数据并合并坐标信息
    if (isEnglish) {
      const enResponse = await fetch('data/mao_trajectory_events_en.json');
      if (!enResponse.ok) {
        throw new Error(
          `加载英文事件数据失败: ${enResponse.status} - ${enResponse.statusText}`
        );
      }
      const enData = await enResponse.json();

      if (
        !enData.events ||
        !Array.isArray(enData.events) ||
        enData.events.length === 0
      ) {
        throw new Error("英文事件数据格式错误或为空");
      }

      // 中文资料是事件身份与坐标的基准。按日期队列匹配，避免缺译一条后整体错位。
      const translationsByDate = new Map();
      enData.events.forEach(event => {
        if (!translationsByDate.has(event.date)) translationsByDate.set(event.date, []);
        translationsByDate.get(event.date).push(event);
      });
      const movementTranslations = {
        "出生": "Birth", "原地活动": "Local Activity", "短途移动": "Short-distance Movement",
        "长途移动": "Long-distance Movement", "国际移动": "International Movement",
      };
      const mergedData = {
        title: enData.title,
        events: zhData.events.map((zhEvent, index) => {
          const enEvent = translationsByDate.get(zhEvent.date)?.shift();
          return {
            ...zhEvent,
            ...enEvent,
            id: `journey-${index}`,
            event: enEvent?.event || (zhEvent.event === "视察安徽" ? "Inspection visit to Anhui" : zhEvent.event),
            movementType: enEvent?.movementType || movementTranslations[zhEvent.movementType] || zhEvent.movementType,
            coordinates: zhEvent.coordinates,
            verification: enEvent?.verification || zhEvent.verification,
            userVerification: zhEvent.userVerification,
          };
        })
      };

      console.log('英文数据已与中文坐标信息合并');
      return processTrajectoryData(mergedData);
    }

    return processTrajectoryData(zhData);
  } catch (error) {
    console.error("加载轨迹数据失败:", error);
    throw error;
  }
}

// ==================== 坐标匹配 ====================
/**
 * 构建完整的行政区划路径
 */
function buildFullLocationPath(locationInfo) {
  if (!locationInfo) return null;

  let parts = [];

  if (locationInfo.country && locationInfo.country !== "中国") {
    parts.push(locationInfo.country);
    if (locationInfo.city) {
      parts.push(locationInfo.city);
    }
  } else {
    if (locationInfo.province) {
      parts.push(locationInfo.province);
    }
    if (locationInfo.city) {
      parts.push(locationInfo.city);
    }
    if (locationInfo.district && locationInfo.district !== locationInfo.city) {
      parts.push(locationInfo.district);
    }
  }

  const fullPath = parts.length > 0 ? parts.join(" ") : null;

  return fullPath;
}

/**
 * 根据位置信息获取坐标
 */
function getCoordinates(locationInfo) {
  if (!locationInfo) return null;

  if (locationInfo.coordinates) {
    return locationInfo.coordinates;
  }

  const fullPath = buildFullLocationPath(locationInfo);
  if (fullPath && coordinateMap.has(fullPath)) {
    return coordinateMap.get(fullPath);
  }

  console.warn("无法匹配坐标:", locationInfo, "构建路径:", fullPath);
  return null;
}

/**
 * 获取坐标和格式化地点名称
 */
function getCoordinatesWithLocation(locationInfo) {
  if (!locationInfo) return { coordinates: null, location: "未知地点" };

  if (locationInfo.coordinates) {
    return {
      coordinates: locationInfo.coordinates,
      location: formatLocationName(locationInfo),
    };
  }

  const fullPath = buildFullLocationPath(locationInfo);
  const coordinates =
    fullPath && coordinateMap.has(fullPath)
      ? coordinateMap.get(fullPath)
      : null;

  return {
    coordinates: coordinates,
    location: formatLocationName(locationInfo),
  };
}

/**
 * 格式化地点名称显示
 */
function formatLocationName(locationInfo) {
  if (!locationInfo) return "未知地点";

  let parts = [];

  if (locationInfo.country && locationInfo.country !== "中国") {
    parts.push(locationInfo.country);
    if (locationInfo.city) parts.push(locationInfo.city);
  } else {
    if (locationInfo.province) parts.push(locationInfo.province);
    if (locationInfo.city && locationInfo.city !== locationInfo.province) {
      parts.push(locationInfo.city);
    }
    if (locationInfo.district && locationInfo.district !== locationInfo.city) {
      parts.push(locationInfo.district);
    }
  }

  return parts.length > 0 ? parts.join(" ") : "未知地点";
}

// ==================== 轨迹数据处理 ====================
/**
 * 处理原始轨迹数据，添加坐标信息
 */
function processTrajectoryData(data) {
  const processedEvents = data.events.map((event, index) => {
    const processed = {
      ...event,
      id: event.id || `journey-${index}`,
      index: index,
      startCoords: null,
      endCoords: null,
      transitCoords: [],
      transitStops: [],
      startLocation: null,
      endLocation: null,
    };

    if (event.coordinates && event.coordinates.start) {
      const startResult = getCoordinatesWithLocation(event.coordinates.start);
      processed.startCoords = startResult.coordinates;
      processed.startLocation = startResult.location;
    }

    if (event.coordinates && event.coordinates.end) {
      const endResult = getCoordinatesWithLocation(event.coordinates.end);
      processed.endCoords = endResult.coordinates;
      processed.endLocation = endResult.location;
    }

    if (event.coordinates && event.coordinates.transit) {
      processed.transitStops = event.coordinates.transit
        .map((transit) => getCoordinatesWithLocation(transit))
        .filter((stop) => stop.coordinates !== null);
      processed.transitCoords = processed.transitStops.map(stop => stop.coordinates);
    }

    if (!processed.endLocation && processed.startLocation) {
      processed.endLocation = processed.startLocation;
      processed.endCoords = processed.startCoords;
    }

    return processed;
  });

  return {
    ...data,
    events: processedEvents,
  };
}

// ==================== 位置聚合 ====================
/**
 * 按地理位置聚合事件
 */
function groupEventsByLocation(events, maxIndex, minIndex = 0) {
  const groups = new Map();

  // 获取国际化的访问类型标签
  const birthLabel = i18n.t('ui.visitType.birth');
  const startLabel = i18n.t('ui.visitType.start');
  const destinationLabel = i18n.t('ui.visitType.destination');
  const transitLabel = i18n.t('ui.visitType.transit');
  const activityLabel = i18n.t('ui.visitType.activity');

  // 根据当前语言获取 movementType 标识
  const locale = i18n.getCurrentLocale();
  const birthType = locale === 'en' ? 'Birth' : '出生';
  const localActivityType = locale === 'en' ? 'Local Activity' : '原地活动';

  for (let i = minIndex; i <= maxIndex; i++) {
    const event = events[i];

    if (event.movementType === birthType) {
      if (event.endCoords && event.endLocation) {
        const coordKey = `${event.endCoords[0]},${event.endCoords[1]}`;

        if (!groups.has(coordKey)) {
          groups.set(coordKey, {
            coordinates: event.endCoords,
            location: event.endLocation,
            events: [],
            types: new Set(),
          });
        }

        const group = groups.get(coordKey);
        group.events.push({
          ...event,
          index: i,
          date: event.date,
          event: event.event,
          age: event.age,
          visitType: birthLabel,
        });

        group.types.add(event.movementType);
      }
    } else if (event.movementType === localActivityType) {
      if (event.endCoords && event.endLocation) {
        const coordKey = `${event.endCoords[0]},${event.endCoords[1]}`;

        if (!groups.has(coordKey)) {
          groups.set(coordKey, {
            coordinates: event.endCoords,
            location: event.endLocation,
            events: [],
            types: new Set(),
          });
        }

        const group = groups.get(coordKey);
        group.events.push({
          ...event,
          index: i,
          date: event.date,
          event: event.event,
          age: event.age,
          visitType: activityLabel,
        });

        group.types.add(event.movementType);
      }
    } else {
      if (event.startCoords && event.startLocation) {
        const coordKey = `${event.startCoords[0]},${event.startCoords[1]}`;

        if (!groups.has(coordKey)) {
          groups.set(coordKey, {
            coordinates: event.startCoords,
            location: event.startLocation,
            events: [],
            types: new Set(),
          });
        }

        const group = groups.get(coordKey);
        group.events.push({
          ...event,
          index: i,
          date: event.date,
          event: event.event,
          age: event.age,
          visitType: startLabel,
        });

        group.types.add(event.movementType);
      }

      if (event.endCoords && event.endLocation) {
        const coordKey = `${event.endCoords[0]},${event.endCoords[1]}`;

        if (!groups.has(coordKey)) {
          groups.set(coordKey, {
            coordinates: event.endCoords,
            location: event.endLocation,
            events: [],
            types: new Set(),
          });
        }

        const group = groups.get(coordKey);
        group.events.push({
          ...event,
          index: i,
          date: event.date,
          event: event.event,
          age: event.age,
          visitType: destinationLabel,
        });

        group.types.add(event.movementType);
      }

      if (
        event.transitCoords &&
        event.transitCoords.length > 0 &&
        event.coordinates &&
        event.coordinates.transit
      ) {
        event.transitStops.forEach((transitResult) => {
          const coords = transitResult.coordinates;
          if (coords) {

            if (transitResult.coordinates && transitResult.location) {
              const coordKey = `${coords[0]},${coords[1]}`;

              if (!groups.has(coordKey)) {
                groups.set(coordKey, {
                  coordinates: coords,
                  location: transitResult.location,
                  events: [],
                  types: new Set(),
                });
              }

              const group = groups.get(coordKey);
              const transitPrefix = i18n.t('ui.panel.transitPrefix');
              group.events.push({
                ...event,
                index: i,
                date: event.date,
                event: transitPrefix + event.event,
                age: event.age,
                visitType: transitLabel,
                originalEvent: event.event,
              });

              group.types.add(event.movementType);
            }
          }
        });
      }
    }
  }

  // 同一事件的起终点或多次途经可能在同一地点；地点数字表示相关事件数。
  groups.forEach(group => {
    const uniqueEvents = new Map();
    group.events.forEach(event => {
      const existing = uniqueEvents.get(event.index);
      if (!existing) {
        uniqueEvents.set(event.index, { ...event, visitTypes: [event.visitType] });
      } else {
        if (!existing.visitTypes.includes(event.visitType)) existing.visitTypes.push(event.visitType);
        if (event.visitType === destinationLabel) existing.visitType = destinationLabel;
      }
    });
    group.events = Array.from(uniqueEvents.values());
  });
  return groups;
}

/**
 * 根据访问次数获取标记样式类
 */
function getVisitCountClass(visitCount) {
  if (visitCount === 1) return "visits-1";
  if (visitCount === 2) return "visits-2";
  if (visitCount === 3) return "visits-3";
  return "visits-4-plus";
}

/**
 * 根据事件类型获取主要标记类型
 */
function getPrimaryMarkerType(types) {
  // 获取当前语言环境
  const locale = i18n.getCurrentLocale();
  const birthType = locale === 'en' ? 'Birth' : '出生';
  const internationalType = locale === 'en' ? 'International Movement' : '国际移动';
  const longDistanceType = locale === 'en' ? 'Long-distance Movement' : '长途移动';
  const shortDistanceType = locale === 'en' ? 'Short-distance Movement' : '短途移动';
  const localActivityType = locale === 'en' ? 'Local Activity' : '原地活动';

  if (types.has(birthType)) return "marker-birth";

  if (types.has(internationalType)) return "marker-international";

  if (types.has(longDistanceType)) return "marker-long-distance";

  if (types.has(shortDistanceType)) return "marker-short-distance";

  const movementTypes = [internationalType, longDistanceType, shortDistanceType].filter((type) =>
    types.has(type)
  );
  if (movementTypes.length > 1) return "marker-mixed";

  if (types.has(localActivityType)) return "marker-activity";

  return "marker-movement";
}

/**
 * 创建地点标记
 */
function createLocationMarker(
  locationGroup,
  isCurrent = false,
  isVisited = false
) {
  const { coordinates, location, events, types } = locationGroup;
  const [lng, lat] = coordinates;
  const visitCount = events.length;

  const markerClasses = [
    "location-marker",
    getPrimaryMarkerType(types),
    getVisitCountClass(visitCount),
  ];

  if (isCurrent) markerClasses.push("current");
  if (isVisited) markerClasses.push("visited");

  const markerContent = visitCount > 1 ? visitCount.toString() : "";

  const baseSize = isMobileDevice() ? 2 : 0;
  const iconSizes = {
    1: [14 + baseSize, 14 + baseSize],
    2: [18 + baseSize, 18 + baseSize],
    3: [22 + baseSize, 22 + baseSize],
    4: [26 + baseSize, 26 + baseSize],
  };

  const sizeKey = visitCount >= 4 ? 4 : visitCount;
  const iconSize = iconSizes[sizeKey];
  const iconAnchor = [iconSize[0] / 2, iconSize[1] / 2];

  const markerElement = L.divIcon({
    className: markerClasses.join(" "),
    html: markerContent,
    iconSize: iconSize,
    iconAnchor: iconAnchor,
  });

  const marker = L.marker([lat, lng], {
    icon: markerElement,
    interactive: true,
    keyboard: true,
    zIndexOffset: isCurrent ? 2000 : 1000,
    title: `${location} · ${visitCount} ${i18n.getCurrentLocale() === "en" ? "events" : "条相关事件"}`,
    alt: location,
  });

  const clickHandler = function (e) {
    e.originalEvent?.stopPropagation();
    stopPlayback();
    showDetailPanel(locationGroup);
  };

  marker._originalClickHandler = clickHandler;

  marker.on("click", clickHandler);

  marker.on("add", function () {
    setTimeout(() => {
      if (marker._icon) {
        marker._icon.style.zIndex = "1000";
        marker._icon.style.pointerEvents = "auto";
        marker._icon.style.cursor = "pointer";
      }
    }, 50);
  });

  let tooltipText;
  if (visitCount === 1) {
    const event = events[0];
    const transitLabel = i18n.t('ui.visitType.transit');
    const transitPrefix = i18n.t('ui.panel.transitPrefix');
    const isTransit = event.visitType === transitLabel;
    tooltipText = `${event.date} - ${isTransit ? transitPrefix : ""}${
      event.originalEvent || event.event
    }`;
  } else {
    // 使用国际化标签进行过滤
    const transitLabel = i18n.t('ui.visitType.transit');
    const destinationLabel = i18n.t('ui.visitType.destination');
    const startLabel = i18n.t('ui.visitType.start');
    const activityLabel = i18n.t('ui.visitType.activity');
    const birthLabel = i18n.t('ui.visitType.birth');

    const transitCount = events.filter((e) => e.visitType === transitLabel).length;
    const destCount = events.filter((e) => e.visitType === destinationLabel).length;
    const startCount = events.filter((e) => e.visitType === startLabel).length;
    const activityCount = events.filter((e) => e.visitType === activityLabel).length;
    const birthCount = events.filter((e) => e.visitType === birthLabel).length;

    let descParts = [];
    // 使用国际化的计数描述
    if (birthCount > 0) descParts.push(`${birthCount}${i18n.t('ui.panel.visitTypes.birth')}`);
    if (destCount > 0) descParts.push(`${destCount}${i18n.t('ui.panel.visitTypes.arrive')}`);
    if (startCount > 0) descParts.push(`${startCount}${i18n.t('ui.panel.visitTypes.depart')}`);
    if (transitCount > 0) descParts.push(`${transitCount}${i18n.t('ui.panel.visitTypes.transit')}`);
    if (activityCount > 0) descParts.push(`${activityCount}${i18n.t('ui.panel.visitTypes.activity')}`);

    tooltipText = `${location} (${descParts.join(
      "，"
    )})`;
  }

  marker.bindTooltip(isCurrent ? escapeHtml(location) : escapeHtml(tooltipText), {
    direction: "top",
    offset: [0, -15],
    opacity: 1, // 背景透明度由共享材质控制，保留文字清晰度。
    className: isCurrent ? "current-location-tooltip" : "simple-tooltip",
    permanent: isCurrent,
  });

  return marker;
}

// ==================== 地图标记和路径  ====================
/**
 * 创建 motion 动画路径
 */
function createMotionPath(
  fromCoords,
  toCoords,
  transitCoords = [],
  isLatest = false,
  eventIndex = null,
  isConnectionPath = false,
  isReverse = false
) {
  if (!fromCoords || !toCoords) return null;

  const pathCoords = [];

  if (isReverse) {
    // 反向路径：从终点到起点
    pathCoords.push([toCoords[1], toCoords[0]]);

    // 反向添加 transit 点
    if (!isConnectionPath && transitCoords && transitCoords.length > 0) {
      for (let i = transitCoords.length - 1; i >= 0; i--) {
        pathCoords.push([transitCoords[i][1], transitCoords[i][0]]);
      }
    }

    pathCoords.push([fromCoords[1], fromCoords[0]]);
  } else {
    // 正向路径：从起点到终点
    pathCoords.push([fromCoords[1], fromCoords[0]]);

    if (!isConnectionPath && transitCoords && transitCoords.length > 0) {
      transitCoords.forEach((coords) => {
        pathCoords.push([coords[1], coords[0]]);
      });
    }

    pathCoords.push([toCoords[1], toCoords[0]]);
  }

  const polylineOptions = {
    color: getRouteColor(isLatest),
    weight: isLatest ? 3.5 : 2,
    opacity: isLatest ? 0.95 : 0.32,
    smoothFactor: 1,
    dashArray: isConnectionPath ? "4, 8" : null,
    interactive: false,
  };
  if (!pathCoords.some((point) => point[0] !== pathCoords[0][0] || point[1] !== pathCoords[0][1])) return null;

  // 拖动时使用极短的动画时间，实现快速显示
  let effectiveDuration = isDragging || prefersReducedMotion() ? 1 : animationConfig.pathDuration;

  const motionOptions = {
    auto: isDragging ? true : false,
    duration: effectiveDuration,
    easing: isDragging
      ? L.Motion.Ease.easeLinear || animationConfig.motionOptions.easing
      : animationConfig.motionOptions.easing,
  };

  const motionPath = L.motion.polyline(
    pathCoords,
    polylineOptions,
    motionOptions
  );

  // 保存路径元数据
  motionPath._isAnimated = true;
  motionPath._isLatest = isLatest;
  motionPath._needsAnimation = isLatest && !isDragging;
  motionPath._eventIndex = eventIndex;
  motionPath._isConnectionPath = isConnectionPath;
  motionPath._isReverse = isReverse;
  motionPath._originalPathCoords = pathCoords;
  motionPath._pathOptions = polylineOptions;

  return motionPath;
}

function getRouteColor(isLatest) {
  const variable = isLatest ? "--color-route" : "--color-history";
  return (map && getComputedStyle(map.getContainer()).getPropertyValue(variable).trim()) ||
    getComputedStyle(document.documentElement).getPropertyValue(variable).trim() ||
    (isLatest ? "#c0392b" : "#7893a3");
}

function refreshAppearance() {
  const currentColor = getRouteColor(true);
  const historyColor = getRouteColor(false);
  pathLayers.forEach(path => {
    const color = path._isLatest || path._eventIndex === currentHighlightedEventIndex ? currentColor : historyColor;
    path.setStyle({ color });
    if (path._path) path._path.style.stroke = color;
    if (path._pathOptions) path._pathOptions.color = color;
  });
  highlightedPaths.forEach(({ path, originalStyle }) => {
    originalStyle.color = path._isLatest ? currentColor : historyColor;
  });
  return true;
}

/**
 * 更新路径样式
 */
function updatePathStyle(path, isLatest) {
  if (!path) return;

  const color = getRouteColor(isLatest);
  const opacity = isLatest ? 0.95 : 0.32;

  path.setStyle({
    color: color,
    opacity: opacity,
    weight: isLatest ? 3.5 : 2,
    dashArray: null,
  });

  path._isLatest = isLatest;

  if (path._path) {
    path._path.style.stroke = color;
    path._path.style.strokeOpacity = opacity;
  }
}

/**
 * 静态更新路径（无动画）
 */
function updatePathsStatic(targetIndex) {
  pathLayers.forEach((path) => {
    if (path._map) {
      map.removeLayer(path);
    }
  });
  pathLayers = [];
  motionPaths.clear();

  // 获取当前语言环境的本地活动类型标识
  const locale = i18n.getCurrentLocale();
  const localActivityType = locale === 'en' ? 'Local Activity' : '原地活动';

  for (let i = routeScope === "current" ? targetIndex : 0; i <= targetIndex; i++) {
    const currentEvent = trajectoryData.events[i];

    if (
      currentEvent.startCoords &&
      currentEvent.endCoords &&
      currentEvent.movementType !== localActivityType
    ) {
      const isLatest = i === targetIndex;
      const motionPath = createMotionPath(
        currentEvent.startCoords,
        currentEvent.endCoords,
        currentEvent.transitCoords,
        isLatest,
        i,
        false,
        false
      );

      if (motionPath) {
        motionPath._needsAnimation = false;
        motionPath._initiallyHidden = false;
        motionPath.addTo(map);
        pathLayers.push(motionPath);
        motionPaths.set(i, motionPath);
        // leaflet.motion 初始路径为空；静态跳转必须显式完成路径。
        motionPath.motionStop();
      }
    }
  }
}

/**
 * 创建路径消失动画
 */
function animatePathDisappear(path) {
  if (!path || !path._map) return;

  const pathElement = path._path;
  if (!pathElement) {
    map.removeLayer(path);
    return;
  }

  const totalLength = pathElement.getTotalLength();

  pathElement.style.strokeDasharray = totalLength;
  pathElement.style.strokeDashoffset = "0";
  pathElement.style.transition = `stroke-dashoffset ${animationConfig.pathDuration}ms ease-in-out, opacity ${animationConfig.pathDuration}ms ease-in-out`;

  setTimeout(() => {
    pathElement.style.strokeDashoffset = totalLength;
    pathElement.style.opacity = "0";
  }, 50);

  setTimeout(() => {
    if (path._map) {
      map.removeLayer(path);
    }
  }, animationConfig.pathDuration + 100);
}

/**
 * 批量执行路径消失动画
 */
function batchAnimatePathsDisappear(paths, staggerDelay = 200) {
  if (!paths || paths.length === 0) return;

  return new Promise((resolve) => {
    let completedCount = 0;
    const totalPaths = paths.length;

    paths.forEach((path, index) => {
      setTimeout(() => {
        animatePathDisappear(path);

        completedCount++;
        if (completedCount === totalPaths) {
          setTimeout(() => {
            resolve();
          }, animationConfig.pathDuration + 100);
        }
      }, index * staggerDelay);
    });
  });
}

/**
 * 动画更新路径
 */
function updatePathsAnimated(targetIndex, isReverse = false) {
  // 统一重建使快速跳转、反向浏览与范围切换不会留下延迟删除的旧路线。
  updatePathsStatic(targetIndex);
  const latestPath = motionPaths.get(targetIndex);
  if (!isReverse && !prefersReducedMotion() && latestPath) latestPath.motionStart();
}

/**
 * 更新事件标记
 */
function updateEventMarkers(targetIndex) {
  eventMarkers.forEach((marker) => map.removeLayer(marker));
  eventMarkers = [];
  locationMarkers.clear();

  locationGroups = groupEventsByLocation(trajectoryData.events, targetIndex, routeScope === "current" ? targetIndex : 0);

  const currentEvent = trajectoryData.events[targetIndex];
  const currentCoordKey = currentEvent.endCoords
    ? `${currentEvent.endCoords[0]},${currentEvent.endCoords[1]}`
    : null;

  locationGroups.forEach((locationGroup, coordKey) => {
    const isCurrent = coordKey === currentCoordKey;
    const isVisited = !isCurrent;

    const marker = createLocationMarker(locationGroup, isCurrent, isVisited);

    if (marker) {
      marker.addTo(map);
      eventMarkers.push(marker);
      locationMarkers.set(coordKey, marker);
    }
  });

  setTimeout(() => {
    ensureMarkersInteractivity();
  }, 100);
}

/**
 * 确保标记交互性正常工作
 */
function ensureMarkersInteractivity() {
  eventMarkers.forEach((marker) => {
    if (marker._icon) {
      const zIndex = Math.abs(parseInt(marker._icon.style.zIndex) || 0) || 1000;
      marker._icon.style.zIndex = zIndex;

      marker._icon.style.pointerEvents = "auto";
      marker._icon.style.cursor = "pointer";

      if (!marker._hasInteractivityEnsured) {
        marker._hasInteractivityEnsured = true;

        const originalOnClick = marker._originalClickHandler;
        if (originalOnClick) {
          marker.off("click");
          marker.on("click", originalOnClick);
        }
      }
    }
  });

  if (map && map.invalidateSize) {
    map.invalidateSize({
      animate: false,
      pan: false,
    });
  }
}

// ==================== 动画控制 ====================

/**
 * 拖动预览：只更新文字信息和进度，不重建路径和标记
 * 避免拖动滑块时的卡顿和视觉闪烁
 */
function updateDragPreview(index) {
  if (!trajectoryData || index >= trajectoryData.events.length || index < 0) return;

  const event = trajectoryData.events[index];

  // 只更新文字信息（轻量操作）
  updateCurrentEventInfo(event);
  updateProgress(index);
  const snapshot = publicEvents[index] || freezeSnapshot(JSON.parse(JSON.stringify(event)));
  document.dispatchEvent(new CustomEvent("journey:event-preview", { detail: { index, event: snapshot } }));
}

/**
 * 显示指定索引的事件
 */
function showEventAtIndex(index, animated = true, isUserAction = false) {
  if (!Number.isInteger(index) || !trajectoryData || index >= trajectoryData.events.length || index < 0)
    return;

  // 动画锁逻辑：
  // - 自动播放触发时（!isUserAction），如果正在动画中则跳过（防止堆叠）
  // - 用户主动操作时（isUserAction），中断当前动画并立即执行
  if (animationConfig.isAnimating && !isUserAction) return;

  document.dispatchEvent(new Event('journey:before-event-change'));
  if (isUserAction) stopPlayback();
  cancelJourneyAnimation();
  animated = animated && !prefersReducedMotion() && Math.abs(index - currentEventIndex) === 1;
  const renderVersion = eventRenderVersion;

  const isMovingForward = index > currentEventIndex;
  const isMovingBackward = index < currentEventIndex;

  previousEventIndex = currentEventIndex;
  currentEventIndex = index;
  const event = trajectoryData.events[index];

  if (animated && (isMovingForward || isMovingBackward)) {
    animationConfig.isAnimating = true;
    if (animationConfig._lockTimer) clearTimeout(animationConfig._lockTimer);
    animationConfig._lockTimer = setTimeout(() => {
      animationConfig.isAnimating = false;
      animationConfig._lockTimer = null;
    }, animationConfig.pathDuration + 100);
  }

  updateCurrentEventInfo(event);
  updateProgress();
  updateEventMarkers(index);

  if (animated && (isMovingForward || isMovingBackward)) {
    updatePathsAnimated(index, isMovingBackward);
  } else {
    updatePathsStatic(index);
  }

  if (isCameraFollowEnabled && !isUserInteracting) {
    if (cameraFollowMode === "path" && animated && (isMovingForward || isMovingBackward) && !isMovingBackward) {
      // 沿路模式：追踪最新创建的 motion path
      const latestMotionPath = motionPaths.get(index);
      if (latestMotionPath) {
        startPathFollowCamera(latestMotionPath);
      } else {
        handleCameraFollow(event, previousEventIndex, animated);
      }
    } else {
      // 智能模式或回退
      stopPathFollowCamera();
      handleCameraFollow(event, previousEventIndex, animated);
    }
  }

  if (animated) {
    setTimeout(() => {
      if (renderVersion !== eventRenderVersion) return;
      ensureMarkersInteractivity();
      stopPathFollowCamera();
    }, animationConfig.pathDuration + 100);
  }
  updatePlaybackUI();
  publishJourneyEvent();
}

// ==================== 镜头跟随控制 ====================

/**
 * 计算两个坐标之间的近似距离（度数距离，非精确球面距离，用于快速分级即可）
 */
function coordDistance(a, b) {
  if (!a || !b) return 0;
  const dlat = a[1] - b[1];
  const dlng = a[0] - b[0];
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

/**
 * 处理镜头跟随逻辑（智能策略）
 *
 * 策略：
 * - 用户正在手动交互地图时，暂不跟随
 * - 短距离移动（同城/邻省）：flyTo 终点，保持当前缩放级别，平滑过渡
 * - 长途移动（跨多省）：flyToBounds 展示完整路径
 * - 原地活动：不移动镜头
 * - 镜头动画时长略短于路径动画时长，让镜头先到位
 */
function handleCameraFollow(currentEvent, previousIndex, animated = true) {
  if (!currentEvent) return;

  // 用户正在手动交互地图，暂停跟随
  if (isUserInteracting) return;

  const prevEvent = previousIndex >= 0 ? trajectoryData.events[previousIndex] : null;
  const startCoords = currentEvent.startCoords;
  const endCoords = currentEvent.endCoords;

  if (!endCoords) return;

  // 计算移动距离
  const distance = Math.max(0, ...[startCoords, ...currentEvent.transitCoords].filter(Boolean)
    .map(coords => coordDistance(coords, endCoords)));
  animated = animated && !prefersReducedMotion();

  // 镜头时长略短于路径动画，让镜头先到位
  const cameraDuration = animated ? Math.max(300, animationConfig.cameraFollowDuration * 0.8) / 1000 : 0;
  const panDuration = animated ? Math.max(200, animationConfig.cameraPanDuration * 0.8) / 1000 : 0;

  // 原地活动（距离极小或无起点）：温和平移到终点，不改变缩放
  if (distance < 0.5) {
    const [lng, lat] = endCoords;
    if (prevEvent?.endCoords && coordDistance(prevEvent.endCoords, endCoords) < 0.01 &&
        isJourneyPointVisible([lat, lng])) return;
    const targetZoom = Math.max(map.getZoom(), 6);
    withProgrammaticCamera(() => map.flyTo(getJourneyCameraCenter([lat, lng], targetZoom), targetZoom, {
      animate: animated,
      duration: panDuration,
      easeLinearity: 0.5,
    }), panDuration * 1000);
    return;
  }

  // 短距离移动（< 3度，约同省或邻省）：飞到终点，适度缩放
  if (distance < 3) {
    const [lng, lat] = endCoords;
    // 根据距离选择缩放级别：越近越放大
    const targetZoom = distance < 1 ? Math.max(map.getZoom(), 7) :
                       distance < 2 ? Math.max(map.getZoom(), 6) : 6;
    withProgrammaticCamera(() => map.flyTo(getJourneyCameraCenter([lat, lng], targetZoom), targetZoom, {
      animate: animated,
      duration: cameraDuration,
      easeLinearity: 0.5,
    }), cameraDuration * 1000);
    return;
  }

  // 长途移动（≥ 3度）：展示完整路径
  const bounds = calculatePathBounds(currentEvent, previousIndex);
  if (bounds && bounds.isValid()) {
    withProgrammaticCamera(() => map.flyToBounds(bounds, {
      animate: animated,
      duration: cameraDuration,
      ...getJourneyMapPadding(),
      maxZoom: 8,
      easeLinearity: 0.5,
    }), cameraDuration * 1000);
  } else {
    // fallback：飞到终点
    const [lng, lat] = endCoords;
    withProgrammaticCamera(() => map.flyTo(getJourneyCameraCenter([lat, lng], 6), 6, {
      animate: animated,
      duration: cameraDuration,
      easeLinearity: 0.5,
    }), cameraDuration * 1000);
  }
}

/**
 * 计算路径边界框
 */
function calculatePathBounds(currentEvent, previousIndex) {
  const coordinates = [];

  if (currentEvent.startCoords) {
    coordinates.push([
      currentEvent.startCoords[1],
      currentEvent.startCoords[0],
    ]);
  }

  if (currentEvent.transitCoords && currentEvent.transitCoords.length > 0) {
    currentEvent.transitCoords.forEach((coords) => {
      if (coords && coords.length === 2) {
        coordinates.push([coords[1], coords[0]]);
      }
    });
  }

  if (currentEvent.endCoords) {
    coordinates.push([currentEvent.endCoords[1], currentEvent.endCoords[0]]);
  }

  if (coordinates.length === 1) {
    const [lat, lng] = coordinates[0];
    const offset = 0.1;
    coordinates.push([lat + offset, lng + offset]);
    coordinates.push([lat - offset, lng - offset]);
  }

  if (coordinates.length >= 2) {
    try {
      return L.latLngBounds(coordinates);
    } catch (error) {
      console.warn("计算边界框失败:", error);
      return null;
    }
  }

  return null;
}

/**
 * 初始化用户地图交互检测
 * 用户手动拖拽/缩放地图时，暂停镜头跟随数秒
 */
function initMapInteractionDetection() {
  if (!map) return;

  const pauseDuration = 4000; // 用户交互后暂停跟随 4 秒

  function onUserInteraction() {
    stopPathFollowCamera();
    isUserInteracting = true;
    if (userInteractionTimeout) clearTimeout(userInteractionTimeout);
    userInteractionTimeout = setTimeout(() => {
      isUserInteracting = false;
      userInteractionTimeout = null;
    }, pauseDuration);
  }

  map.on('dragstart', onUserInteraction);
  map.getContainer().addEventListener('pointerdown', onUserInteraction, { passive: true });
  map.getContainer().addEventListener('wheel', onUserInteraction, { passive: true });
  map.on('zoomstart', function(e) {
    // 只检测用户手动缩放（非程序触发）
    // flyTo/flyToBounds 会触发 zoomstart，但不应标记为用户交互
    // 通过检查是否有正在进行的动画来区分
    if (!mapCameraIsProgrammatic) {
      onUserInteraction();
    }
  });
}

/**
 * 初始化跟随模式选择器
 */
function initFollowModeSelector() {
  const selector = document.getElementById("follow-mode-selector");
  const saved = readStoredPreference("cameraFollowMode");
  // 新模式优先；只有缺少有效模式时才迁移旧版布尔设置。
  cameraFollowMode = ["smart", "path", "off"].includes(saved)
    ? saved
    : readStoredPreference("cameraFollowEnabled") === "false" ? "off" : "smart";
  isCameraFollowEnabled = cameraFollowMode !== "off";
  writeStoredPreference("cameraFollowMode", cameraFollowMode);
  if (!selector) return;

  // 设置初始 UI 状态
  const buttons = selector.querySelectorAll(".follow-mode-btn");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === cameraFollowMode);
    btn.setAttribute("aria-pressed", String(btn.dataset.mode === cameraFollowMode));
    btn.addEventListener("click", () => {
      buttons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      cameraFollowMode = btn.dataset.mode;
      isCameraFollowEnabled = cameraFollowMode !== "off";
      stopPathFollowCamera();

      // 显示/隐藏缩放滑块（仅沿路模式下有意义）
      const zoomRow = document.getElementById("follow-zoom-row");
      if (zoomRow) {
        zoomRow.style.display = cameraFollowMode === "path" ? "flex" : "none";
      }

      writeStoredPreference("cameraFollowMode", cameraFollowMode);
    });
  });

  // 初始显示状态
  const zoomRow = document.getElementById("follow-zoom-row");
  if (zoomRow) {
    zoomRow.style.display = cameraFollowMode === "path" ? "flex" : "none";
  }
}

/**
 * 初始化跟随缩放滑块
 */
function initFollowZoomSlider() {
  const slider = document.getElementById("follow-zoom-slider");
  const display = document.getElementById("follow-zoom-display");
  if (!slider) return;

  pathFollowZoom = normalizePreferenceNumber(readStoredPreference("pathFollowZoom"), 7, 5, 10, 0.5);
  slider.value = String(pathFollowZoom);
  writeStoredPreference("pathFollowZoom", pathFollowZoom);
  if (display) display.textContent = pathFollowZoom;
  window.JourneyControls?.sync(slider);

  slider.addEventListener("input", (e) => {
    pathFollowZoom = normalizePreferenceNumber(e.target.value, pathFollowZoom, 5, 10, 0.5);
    slider.value = String(pathFollowZoom);
    if (display) display.textContent = pathFollowZoom;
    window.JourneyControls?.sync(slider);
    writeStoredPreference("pathFollowZoom", pathFollowZoom);
  });
}

/**
 * 初始化路径动画时长倍率滑块
 */
function initPathSpeedMultiplier() {
  const slider = document.getElementById("path-speed-multiplier");
  const display = document.getElementById("path-speed-display");
  if (!slider) return;

  pathSpeedMultiplier = normalizePreferenceNumber(readStoredPreference("pathSpeedMultiplier"), 2.5, 1, 5, 0.5);
  slider.value = String(pathSpeedMultiplier);
  writeStoredPreference("pathSpeedMultiplier", pathSpeedMultiplier);
  if (display) display.textContent = pathSpeedMultiplier + "x";
  window.JourneyControls?.sync(slider);
  applySpeedPreset(currentSpeedLevel);

  slider.addEventListener("input", (e) => {
    pathSpeedMultiplier = normalizePreferenceNumber(e.target.value, pathSpeedMultiplier, 1, 5, 0.5);
    slider.value = String(pathSpeedMultiplier);
    if (display) display.textContent = pathSpeedMultiplier + "x";
    window.JourneyControls?.sync(slider);
    // 重新应用当前速度档位（倍率会自动生效）
    applySpeedPreset(currentSpeedLevel);
    writeStoredPreference("pathSpeedMultiplier", pathSpeedMultiplier);
  });
}

/**
 * 启动沿路径跟随镜头
 * 通过追踪 leaflet.motion 的动画标记位置来实现
 */
function startPathFollowCamera(motionPath) {
  stopPathFollowCamera();

  if (!motionPath || cameraFollowMode !== "path" || prefersReducedMotion() || isUserInteracting) return;

  // 先设置缩放级别
  const currentCenter = map.getCenter();
  withProgrammaticCamera(() => map.setView(currentCenter, pathFollowZoom, { animate: false }));

  // 获取路径坐标
  const pathCoords = motionPath._originalPathCoords;
  if (!pathCoords || pathCoords.length < 2) return;

  const startTime = performance.now();
  const duration = animationConfig.pathDuration;

  function followFrame(now) {
    if (isUserInteracting || cameraFollowMode !== "path" || !motionPath._map) {
      stopPathFollowCamera();
      return;
    }
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // 用 easing 匹配路径动画的节奏
    const easedProgress = easeInOutQuart(progress);

    // 与 motion 插件按实际路段距离插值，避免长短路段镜头和路径不同步。
    const position = L.Motion.Utils.interpolateOnLine(map, pathCoords.map(point => L.latLng(point)), easedProgress);
    if (position?.latLng) map.panTo(getJourneyCameraCenter(position.latLng), { animate: false, noMoveStart: true });

    if (progress < 1) {
      pathFollowAnimationId = requestAnimationFrame(followFrame);
    } else {
      pathFollowAnimationId = null;
    }
  }

  pathFollowAnimationId = requestAnimationFrame(followFrame);
}

/**
 * 停止沿路径跟随镜头
 */
function stopPathFollowCamera() {
  if (pathFollowAnimationId) {
    cancelAnimationFrame(pathFollowAnimationId);
    pathFollowAnimationId = null;
  }
}

/**
 * easeInOutQuart 缓动函数，与 leaflet.motion 的默认 easing 匹配
 */
function easeInOutQuart(t) {
  return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t;
}

// 兼容旧代码调用
function initCameraFollowControl() {
  // 设置面板已统一恢复新旧偏好，不再让旧布尔值覆盖已恢复的模式。
  isCameraFollowEnabled = cameraFollowMode !== "off";
}

function updateCameraFollowUI() {
  // 不再需要独立UI
}

// ==================== 路径高亮功能 ====================
/**
 * 高亮指定事件的路径
 */
function highlightEventPath(eventIndex) {
  if (
    !trajectoryData ||
    eventIndex < 0 ||
    eventIndex >= trajectoryData.events.length
  ) {
    return;
  }

  clearPathHighlight();

  const motionPath = motionPaths.get(eventIndex);

  if (motionPath && motionPath._map) {
    const originalStyle = {
      color: motionPath.options.color,
      weight: motionPath.options.weight,
      opacity: motionPath.options.opacity,
      dashArray: motionPath.options.dashArray,
    };

    motionPath.setStyle({
      color: getRouteColor(true),
      weight: 5,
      opacity: 0.9,
      dashArray: "10, 0",
    });

    if (!prefersReducedMotion()) motionPath.motionStart();

    highlightedPaths.push({
      path: motionPath,
      originalStyle: originalStyle,
    });

    currentHighlightedEventIndex = eventIndex;

    if (highlightTimeout) {
      clearTimeout(highlightTimeout);
    }

    highlightTimeout = setTimeout(() => {
      clearPathHighlight();
    }, 4000);

    // 聚焦到路径
    if (motionPath.getBounds && isCameraFollowEnabled) {
      try {
        const bounds = motionPath.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, {
            ...getJourneyMapPadding(),
            maxZoom: 8,
            animate: true,
            duration: animationConfig.cameraFollowDuration / 1000, // 镜头时长
            easeLinearity: 0.5,
          });
        }
      } catch (error) {
        console.warn("聚焦路径失败:", error);
      }
    }
  }
}

/**
 * 清除路径高亮
 */
function clearPathHighlight() {
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
    highlightTimeout = null;
  }

  highlightedPaths.forEach(({ path, originalStyle }) => {
    if (path && path._map) {
      try {
        path.setStyle(originalStyle);
        path.motionStop();
      } catch (error) {
        console.warn("恢复路径样式失败:", error);
      }
    }
  });

  highlightedPaths = [];
  currentHighlightedEventIndex = -1;
}

/**
 * 快速清除路径高亮
 */
function quickClearPathHighlight() {
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
    highlightTimeout = null;
  }

  highlightedPaths.forEach(({ path, originalStyle }) => {
    if (path && path._map) {
      try {
        path.setStyle({
          ...originalStyle,
          opacity: originalStyle.opacity * 0.3,
        });

        setTimeout(() => {
          if (path && path._map) {
            path.setStyle(originalStyle);
            path.motionStop();
          }
        }, 200);
      } catch (error) {
        console.warn("快速清除路径高亮失败:", error);
      }
    }
  });

  highlightedPaths = [];
  currentHighlightedEventIndex = -1;
}

// ==================== UI更新 ====================
/**
 * 更新当前事件信息显示
 */
function updateCurrentEventInfo(event) {
  const pcElements = {
    "event-date": event.date,
    "event-title": event.event,
    "event-location": event.endLocation,
    "current-age": event.age,
  };

  const tooltipIds = new Set(["event-title", "event-location", "event-title-mobile", "event-location-mobile"]);

  Object.entries(pcElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
      if (tooltipIds.has(id)) element.title = value;
    }
  });

  const mobileElements = {
    "event-date-mobile": event.date,
    "event-title-mobile": event.event,
    "event-location-mobile": event.endLocation,
    "current-age-mobile": event.age,
  };

  Object.entries(mobileElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
      if (tooltipIds.has(id)) element.title = value;
    }
  });
}

/**
 * 更新进度信息
 */
function updateProgress(index = currentEventIndex) {
  const event = trajectoryData?.events[index];
  if (!event) return;
  const progress = ((index + 1) / trajectoryData.events.length) * 100;

  const mobileElements = {
    "current-progress-mobile": progress.toFixed(1) + "%",
    "current-event-index-mobile": index + 1,
  };

  Object.entries(mobileElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  });

  const desktopElements = {
    "current-progress-desktop": progress.toFixed(1) + "%",
    "current-event-index-desktop": index + 1,
    "current-age-desktop": event.age,
  };

  Object.entries(desktopElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  });

  const slider = document.getElementById("timeline-slider");
  if (slider && !slider.matches(":active")) {
    slider.value = index;
  }
  if (slider) {
    slider.setAttribute("aria-valuetext", `${event.date} · ${event.event}`);
    slider.style.setProperty("--timeline-progress", `${trajectoryData.events.length > 1 ? index / (trajectoryData.events.length - 1) * 100 : 0}%`);
    window.JourneyControls?.sync(slider);
  }
}

/**
 * 更新统计数据
 */
function updateStatistics() {
  if (!trajectoryData || !trajectoryData.events) return;

  const locale = i18n.getCurrentLocale();
  const events = trajectoryData.events;

  // 根据语言选择对应的movementType值
  const birthType = locale === 'en' ? 'Birth' : '出生';
  const localActivityType = locale === 'en' ? 'Local Activity' : '原地活动';
  const internationalType = locale === 'en' ? 'International Movement' : '国际移动';

  const movementEvents = events.filter(
    (e) => e.movementType !== birthType && e.movementType !== localActivityType
  );
  const internationalEvents = events.filter(
    (e) => e.movementType === internationalType
  );

  const visitedPlaces = new Set();
  events.forEach((event) => {
    const location = event.coordinates?.end || event.coordinates?.start;
    if (location) visitedPlaces.add(location.province || location.city || location.country);
  });

  const startYear = parseInt(events[0].date.split("-")[0]);
  const endYear = parseInt(events[events.length - 1].date.split("-")[0]);
  const timeSpan = endYear - startYear;
  const yearSuffix = locale === 'en' ? ' years' : '年';

  const pcStats = {
    "total-events": events.length,
    "movement-count": movementEvents.length,
    "visited-places": visitedPlaces.size,
    "international-count": internationalEvents.length,
    "time-span": timeSpan + yearSuffix,
  };

  Object.entries(pcStats).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  });
}

// ==================== 播放控制 ====================
/**
 * 切换播放/暂停状态
 */
function togglePlay() {
  if (!trajectoryData?.events.length) return;
  if (isPlaying) {
    stopPlayback();
  } else {
    const restarting = currentEventIndex === trajectoryData.events.length - 1;
    if (restarting) goToJourneyEvent(0);
    isPlaying = true;
    updatePlaybackUI();
    scheduleNextPlayback();
  }
}

function stopPlayback() {
  isPlaying = false;
  clearTimeout(playInterval);
  playInterval = null;
  clearTimeout(animationConfig._lockTimer);
  animationConfig._lockTimer = null;
  animationConfig.isAnimating = false;
  stopPathFollowCamera();
  motionPaths.get(currentEventIndex)?.motionStop();
  updatePlaybackUI();
}

function updatePlaybackUI() {
  const count = trajectoryData?.events.length || 0;
  const isEnglish = i18n.getCurrentLocale() === "en";
  const button = document.getElementById("play-btn");
  if (button) {
    const label = isPlaying ? (isEnglish ? "Pause" : "暂停") :
      (count && currentEventIndex === count - 1 ? (isEnglish ? "Replay from the beginning" : "从头重播") : (isEnglish ? "Play" : "播放"));
    button.innerHTML = window.JourneyIcons.svg(isPlaying ? 'pause' : count && currentEventIndex === count - 1 ? 'rotate-ccw' : 'play');
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(isPlaying));
    button.disabled = !count;
  }
  const previous = document.getElementById("prev-btn");
  const next = document.getElementById("next-btn");
  if (previous) {
    previous.disabled = !count || currentEventIndex === 0;
    previous.setAttribute("aria-label", isEnglish ? "Previous event" : "上一个事件");
  }
  if (next) {
    next.disabled = !count || currentEventIndex === count - 1;
    next.setAttribute("aria-label", isEnglish ? "Next event" : "下一个事件");
  }
}

function scheduleNextPlayback() {
  clearTimeout(playInterval);
  if (!isPlaying) return;
  const preset = UNIFIED_SPEED_PRESETS[currentSpeedLevel];
  const waitTime = prefersReducedMotion() ? preset.playInterval : Math.max(preset.playInterval, animationConfig.pathDuration + 200);
  playInterval = setTimeout(playNextEvent, waitTime);
}

/**
 * 递归播放下一个事件
 */
function playNextEvent() {
  if (!isPlaying || currentEventIndex >= trajectoryData.events.length - 1) {
    stopPlayback();
    return;
  }

  const nextIndex = currentEventIndex + 1;
  const isLastEvent = nextIndex >= trajectoryData.events.length - 1;

  showEventAtIndex(nextIndex, true);

  if (isLastEvent) {
    stopPlayback();
    return;
  }

  // 统一速度模型：等待时间 = 路径动画时长 + 缓冲，确保动画完成后再播下一个
  scheduleNextPlayback();
}

/**
 * 下一个事件
 */
function nextEvent() {
  if (trajectoryData && currentEventIndex < trajectoryData.events.length - 1) {
    showEventAtIndex(currentEventIndex + 1, true, true); // isUserAction=true
  }
}

/**
 * 上一个事件
 */
function previousEvent() {
  if (trajectoryData && currentEventIndex > 0) {
    showEventAtIndex(currentEventIndex - 1, true, true); // isUserAction=true
  }
}

// ==================== 键盘控制 ====================
/**
 * 统一的键盘事件处理函数
 */
function handleTimelineKeydown(e) {
  if (!trajectoryData || !trajectoryData.events) return;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target?.closest?.('button, input, textarea, select, a, summary, .leaflet-container, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"]')) return;
  if (document.querySelector('.music-modal.visible, .feedback-modal.visible, .wechat-qr-modal.visible, .location-detail-panel.visible, .settings-panel.visible, .drawer.visible, [role="dialog"].visible')) return;

  let newIndex = currentEventIndex;
  let handled = false;

  switch (e.key) {
    case "ArrowLeft":
    case "ArrowDown":
      newIndex = Math.max(0, currentEventIndex - 1);
      handled = true;
      break;
    case "ArrowRight":
    case "ArrowUp":
      newIndex = Math.min(
        trajectoryData.events.length - 1,
        currentEventIndex + 1
      );
      handled = true;
      break;
    case "Home":
      newIndex = 0;
      handled = true;
      break;
    case "End":
      newIndex = trajectoryData.events.length - 1;
      handled = true;
      break;
    case " ":
      e.preventDefault();
      togglePlay();
      return;
  }

  if (handled) {
    e.preventDefault();
    if (newIndex !== currentEventIndex) {
      showEventAtIndex(newIndex, true, true);
    }
  }
}

// ==================== 动画设置控制 ====================
/**
 * 初始化动画控制（统一速度模型）
 */
function initAnimationControls() {
  const saved = readStoredPreference("speedLevel");
  const level = saved === null || saved.trim() === "" ? NaN : Number(saved);
  currentSpeedLevel = Number.isInteger(level) && level >= 0 && level < UNIFIED_SPEED_PRESETS.length ? level : 1;

  // 应用当前速度档位
  applySpeedPreset(currentSpeedLevel);
}

/**
 * 应用统一速度档位：自动联动路径、镜头、播放间隔
 */
function applySpeedPreset(levelIndex) {
  if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= UNIFIED_SPEED_PRESETS.length) return;

  const preset = UNIFIED_SPEED_PRESETS[levelIndex];
  currentSpeedLevel = levelIndex;
  currentPlaySpeed = preset.playInterval;
  animationConfig.pathDuration = preset.pathDuration * pathSpeedMultiplier;
  animationConfig.cameraFollowDuration = preset.cameraFollowDuration * pathSpeedMultiplier;
  animationConfig.cameraPanDuration = preset.cameraPanDuration * pathSpeedMultiplier;

  document.documentElement.style.setProperty(
    "--path-animation-duration",
    animationConfig.pathDuration + "ms"
  );

  // 更新所有速度相关 UI
  updateAllSpeedUI();
  if (isPlaying) {
    cancelJourneyAnimation();
    updatePathsStatic(currentEventIndex);
    scheduleNextPlayback();
  }

  writeStoredPreference("speedLevel", levelIndex);
}

/**
 * 更新所有速度相关 UI 元素
 */
function updateAllSpeedUI() {
  const playbackSpeed = document.getElementById("playback-speed");
  if (playbackSpeed) playbackSpeed.value = String(currentSpeedLevel);
  window.JourneyControls?.sync(playbackSpeed);
}

// 兼容旧调用
function updateSpeedUI() {
  updateAllSpeedUI();
}

/**
 * 复制当前事件数据到剪贴板
 */
function copyCurrentEventData() {
  if (!trajectoryData || !trajectoryData.events || currentEventIndex < 0) {
    showTemporaryMessage(i18n.t('messages.noEventData'), "warning");
    return;
  }

  try {
    const currentEvent = trajectoryData.events[currentEventIndex];

    const cleanEventData = {
      date: currentEvent.date,
      age: currentEvent.age,
      movementType: currentEvent.movementType,
      event: currentEvent.event,
      coordinates: currentEvent.coordinates,
      verification: currentEvent.verification || "",
      userVerification: currentEvent.userVerification || [],
    };

    if (cleanEventData.userVerification.length === 0) {
      cleanEventData.userVerification = [
        {
          username: "考据者署名 (可选)",
          comment: "考据补充或感言 (可选)",
          date: "考据日期 (可选)",
        },
      ];
    }

    const jsonString = JSON.stringify(cleanEventData, null, 2);

    const formattedJson = `    ${jsonString.replace(/\n/g, "\n    ")},`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(formattedJson)
        .then(() => {
          const eventNumber = currentEventIndex + 1;
          showTemporaryMessage(
            i18n.t('messages.copySuccess', { number: eventNumber }),
            "success"
          );
        })
        .catch(() => {
          fallbackCopyToClipboard(formattedJson);
        });
    } else {
      fallbackCopyToClipboard(formattedJson);
    }
  } catch (error) {
    console.error("复制事件数据时出错:", error);
    showTemporaryMessage(i18n.t('messages.copyFailed'), "warning");
  }
}

/**
 * 兼容性剪贴板复制方案
 */
function fallbackCopyToClipboard(text) {
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    textArea.setSelectionRange(0, 99999);
    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);

    if (successful) {
      const eventNumber = currentEventIndex + 1;
      showTemporaryMessage(i18n.t('messages.copySuccess', { number: eventNumber }), "success");
    } else {
      showTemporaryMessage(i18n.t('messages.copyManual'), "warning");
    }
  } catch (err) {
    console.error("传统复制方法也失败:", err);
    showTemporaryMessage(i18n.t('messages.copyNotSupported'), "warning");
  }
}

/**
 * 隐藏加载提示
 */
function hideLoading() {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.style.display = "none";
  }
}

// ==================== 音乐播放功能 ====================
const MUSIC_PLAYLIST = [
  {
    id: "internationale",
    title: "国际歌",
    artist: "经典革命歌曲",
    duration: "04:55",
    urls: [
      "data/music/Internationale-cmn_(英特纳雄耐尔).ogg",
      "https://raw.githubusercontent.com/sansan0/mao-map/refs/heads/master/data/music/Internationale-cmn_(英特纳雄耐尔).ogg",
      "https://upload.wikimedia.org/wikipedia/commons/5/5b/Internationale-cmn_%28%E8%8B%B1%E7%89%B9%E7%BA%B3%E9%9B%84%E8%80%90%E5%B0%94%29.ogg",
    ],
  },
  {
    id: "dongfanghong",
    title: "东方红",
    artist: "经典红色歌曲",
    duration: "02:25",
    urls: [
      "data/music/东方红_-_The_East_Is_Red_(1950).ogg",
      "https://raw.githubusercontent.com/sansan0/mao-map/refs/heads/master/data/music/东方红_-_The_East_Is_Red_(1950).ogg",
      "https://upload.wikimedia.org/wikipedia/commons/d/d8/%E4%B8%9C%E6%96%B9%E7%BA%A2_-_The_East_Is_Red_%281950%29.ogg",
    ],
  },
];

/**
 * 清理音频事件监听器
 */
function cleanupMusicEventListeners() {
  if (!musicAudio) return;

  console.log("清理音频事件监听器");

  const eventsToClean = [
    "loadedmetadata",
    "canplaythrough",
    "error",
    "loadstart",
    "loadeddata",
  ];

  eventsToClean.forEach((eventType) => {
    musicAudio.removeEventListener(eventType, () => {});
  });

  currentAudioEventListeners.clear();
}

/**
 * 等待音频准备就绪后自动播放
 */
function autoPlayWhenReady(shouldPlay = true) {
  if (!musicAudio || !shouldPlay) {
    isAutoPlayPending = false;
    return Promise.resolve(false);
  }

  isAutoPlayPending = true;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      console.warn("音频加载超时，取消自动播放");
      isAutoPlayPending = false;
      cleanup();
      resolve(false);
    }, 10000);

    const cleanup = () => {
      clearTimeout(timeoutId);
      musicAudio.removeEventListener("canplaythrough", handleCanPlay);
      musicAudio.removeEventListener("loadedmetadata", handleCanPlay);
      musicAudio.removeEventListener("error", handleError);
    };

    const handleCanPlay = () => {
      cleanup();

      if (isAutoPlayPending) {
        console.log("音频准备就绪，开始自动播放");
        musicAudio
          .play()
          .then(() => {
            isMusicPlaying = true;
            startProgressUpdate();
            updatePlayButton();
            updateMusicBtnState();
            isAutoPlayPending = false;
            resolve(true);
          })
          .catch((error) => {
            console.warn("自动播放失败:", error);
            isAutoPlayPending = false;
            updatePlayButton();
            updateMusicBtnState();
            resolve(false);
          });
      } else {
        resolve(false);
      }
    };

    const handleError = (error) => {
      console.warn("音频加载出错，取消自动播放:", error);
      cleanup();
      isAutoPlayPending = false;
      resolve(false);
    };

    // 检查音频是否已经可以播放
    if (musicAudio.readyState >= 3) {
      cleanup();
      handleCanPlay();
    } else {
      musicAudio.addEventListener("canplaythrough", handleCanPlay, {
        once: true,
      });
      musicAudio.addEventListener("loadedmetadata", handleCanPlay, {
        once: true,
      });
      musicAudio.addEventListener("error", handleError, { once: true });
    }
  });
}

/**
 * 加载音频文件
 */
function loadMusicAudio(song, autoPlay = false) {
  if (!musicAudio) return Promise.resolve(false);

  console.log(`加载音频: ${song.title}, 自动播放: ${autoPlay}`);

  isAutoPlayPending = false;

  if (isMusicPlaying) {
    musicAudio.pause();
    isMusicPlaying = false;
    clearInterval(musicProgressInterval);
  }

  cleanupMusicEventListeners();

  musicAudio.currentTime = 0;
  updateMusicProgress();
  updatePlayButton();
  updateMusicBtnState();

  let urlIndex = 0;

  function tryLoadUrl() {
    return new Promise((resolve) => {
      if (urlIndex >= song.urls.length) {
        console.warn("无法加载音频文件:", song.title);
        showTemporaryMessage(i18n.t('messages.musicLoadError'), "warning");
        resolve(false);
        return;
      }

      const url = song.urls[urlIndex];
      console.log("尝试加载音频:", url);

      const loadTimeoutId = setTimeout(() => {
        console.warn("音频加载超时:", url);
        handleLoadError();
      }, 15000);

      const cleanup = () => {
        clearTimeout(loadTimeoutId);
        musicAudio.removeEventListener("canplaythrough", handleLoadSuccess);
        musicAudio.removeEventListener("loadedmetadata", handleLoadSuccess);
        musicAudio.removeEventListener("error", handleLoadError);
      };

      const handleLoadSuccess = () => {
        console.log("音频加载成功:", url);
        cleanup();

        updatePlayButton();
        updateMusicBtnState();

        if (autoPlay) {
          autoPlayWhenReady(true).then((success) => {
            resolve(success);
          });
        } else {
          resolve(true);
        }
      };

      const handleLoadError = () => {
        console.warn("音频加载失败:", url);
        cleanup();
        urlIndex++;
        tryLoadUrl().then(resolve);
      };

      const loadBlob = (blobOrUrl) => {
          const blobUrl = (blobOrUrl instanceof Blob)
            ? URL.createObjectURL(blobOrUrl)
            : blobOrUrl;
          musicAudio.addEventListener("canplaythrough", handleLoadSuccess, {
            once: true,
          });
          musicAudio.addEventListener("loadedmetadata", handleLoadSuccess, {
            once: true,
          });
          musicAudio.addEventListener("error", handleLoadError, { once: true });
          musicAudio.src = blobUrl;
          musicAudio.volume = musicVolume;
          musicAudio.load();
      };

      // 本地文件（相对路径）直接加载，外部 URL 在 Android 上走 proxy_fetch
      const isLocalUrl = !url.startsWith('http://') && !url.startsWith('https://');
      const IS_ANDROID = /android/i.test(navigator.userAgent);

      if (isLocalUrl || !(IS_ANDROID && window.__TAURI_INTERNALS__)) {
        loadBlob(url);
      } else {
        window.__TAURI_INTERNALS__.invoke('proxy_fetch', { url })
          .then((base64Data) => {
            const binary = atob(base64Data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            loadBlob(new Blob([bytes], { type: 'audio/ogg' }));
          })
          .catch((e) => {
            console.warn("proxy_fetch 失败:", url, e);
            handleLoadError();
          });
      }
    });
  }

  audioLoadingPromise = tryLoadUrl();
  return audioLoadingPromise;
}

/**
 * 播放上一首
 */
function playPreviousSong() {
  const prevIndex =
    currentMusicIndex > 0 ? currentMusicIndex - 1 : MUSIC_PLAYLIST.length - 1;
  const wasPlaying = isMusicPlaying;

  console.log(`播放上一首: 索引 ${prevIndex}, 之前在播放: ${wasPlaying}`);

  selectSong(prevIndex, wasPlaying);
}

/**
 * 播放下一首
 */
function playNextSong() {
  const nextIndex =
    currentMusicIndex < MUSIC_PLAYLIST.length - 1 ? currentMusicIndex + 1 : 0;
  const wasPlaying = isMusicPlaying;

  console.log(`播放下一首: 索引 ${nextIndex}, 之前在播放: ${wasPlaying}`);

  selectSong(nextIndex, wasPlaying);
}

/**
 * 选择歌曲
 */
function selectSong(index, autoPlay = false) {
  if (index < 0 || index >= MUSIC_PLAYLIST.length) return;

  console.log(`选择歌曲: 索引 ${index}, 自动播放: ${autoPlay}`);

  currentMusicIndex = index;
  const song = MUSIC_PLAYLIST[index];
  // 本地上传的 Blob 仅在本次会话有效，保留最后一次内置歌曲选择。
  if (!song.isLocal) writeStoredPreference("mao-map:music-song", song.id);

  const titleEl = document.getElementById("current-song-title");
  const artistEl = document.getElementById("current-song-artist");

  if (titleEl) titleEl.textContent = song.title;
  if (artistEl) artistEl.textContent = song.artist;

  const playlistItems = document.querySelectorAll(".playlist-item");
  playlistItems.forEach((item, i) => {
    if (i === index) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  loadMusicAudio(song, autoPlay);
}

/**
 * 切换播放/暂停
 */
function toggleMusicPlay() {
  if (!musicAudio) return;

  if (isMusicPlaying) {
    console.log("暂停音乐播放");
    musicAudio.pause();
    isMusicPlaying = false;
    clearInterval(musicProgressInterval);
    updatePlayButton();
    updateMusicBtnState();
  } else {
    console.log("开始音乐播放");
    const playBtn = document.getElementById("music-play-btn");
    if (playBtn) {
      playBtn.innerHTML = window.JourneyIcons.svg('loader-circle');
      playBtn.title = i18n.t('ui.timeline.loading');
      playBtn.setAttribute('aria-label', playBtn.title);
      playBtn.setAttribute('aria-busy', 'true');
    }

    if (musicAudio.readyState < 3) {
      console.log("音频未准备好，等待加载...");
      autoPlayWhenReady(true);
    } else {
      console.log("音频已准备好，直接播放");
      musicAudio
        .play()
        .then(() => {
          isMusicPlaying = true;
          startProgressUpdate();
          updatePlayButton();
          updateMusicBtnState();
        })
        .catch((error) => {
          console.error("音频播放失败:", error);
          showTemporaryMessage(i18n.t('messages.musicPlayFailed'), "warning");

          isMusicPlaying = false;
          updatePlayButton();
          updateMusicBtnState();
        });
    }
  }
}

/**
 * 处理音乐播放结束
 */
function handleMusicEnded() {
  console.log("音乐播放结束，准备播放下一首");

  isMusicPlaying = false;
  clearInterval(musicProgressInterval);
  updatePlayButton();
  updateMusicBtnState();

  // 自动播放下一首
  setTimeout(() => {
    const nextIndex =
      currentMusicIndex < MUSIC_PLAYLIST.length - 1 ? currentMusicIndex + 1 : 0;
    selectSong(nextIndex, true);
  }, 500);
}

/**
 * 初始化音乐播放功能
 */
function initMusicPlayer() {
  const musicBtn = document.getElementById("music-btn");
  const musicModal = document.getElementById("music-modal");
  const musicBackdrop = document.getElementById("music-backdrop");
  const musicClose = document.getElementById("music-modal-close");
  const musicAudioElement = document.getElementById("music-audio");

  musicAudio = musicAudioElement;

  if (musicBtn) {
    musicBtn.addEventListener("click", showMusicModal);
  }

  if (musicClose) {
    musicClose.addEventListener("click", hideMusicModal);
  }

  if (musicBackdrop) {
    musicBackdrop.addEventListener("click", hideMusicModal);
  }

  if (musicModal) {
    musicModal.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  initMusicControls();
  initMusicPlaylist();
  initMusicUpload();
  initVolumeControl();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isMusicModalVisible) {
      hideMusicModal();
    }
  });
}

/**
 * 显示音乐弹窗
 */
function showMusicModal() {
  const musicModal = document.getElementById("music-modal");
  const musicBackdrop = document.getElementById("music-backdrop");

  if (musicModal && musicBackdrop) {
    musicBackdrop.classList.add("visible");
    musicModal.classList.add("visible");
    isMusicModalVisible = true;

    document.body.style.overflow = "hidden";
  }
}

/**
 * 隐藏音乐弹窗
 */
function hideMusicModal() {
  const musicModal = document.getElementById("music-modal");
  const musicBackdrop = document.getElementById("music-backdrop");

  if (musicModal && musicBackdrop) {
    musicBackdrop.classList.remove("visible");
    musicModal.classList.remove("visible");
    isMusicModalVisible = false;

    document.body.style.overflow = "";
  }
}

/**
 * 初始化音乐播放控制
 */
function initMusicControls() {
  const playBtn = document.getElementById("music-play-btn");
  const prevBtn = document.getElementById("music-prev-btn");
  const nextBtn = document.getElementById("music-next-btn");
  const progressBar = document.querySelector(".music-progress-bar");

  if (playBtn) {
    playBtn.addEventListener("click", toggleMusicPlay);
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", playPreviousSong);
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", playNextSong);
  }

  if (progressBar) {
    progressBar.addEventListener("click", handleProgressClick);
  }

  if (!musicAudio) {
    musicAudio = document.getElementById("music-audio");
  }

  // 绑定基础事件监听器（这些不会被清理）
  if (musicAudio) {
    musicAudio.addEventListener("loadedmetadata", updateMusicDuration);
    musicAudio.addEventListener("timeupdate", updateMusicProgress);
    musicAudio.addEventListener("ended", handleMusicEnded);
    musicAudio.addEventListener("error", handleMusicError);
    // Native media controls and system interruptions also change the tint.
    musicAudio.addEventListener("playing", () => {
      isMusicPlaying = true;
      startProgressUpdate();
      updatePlayButton();
      updateMusicBtnState();
    });
    musicAudio.addEventListener("pause", () => {
      isMusicPlaying = false;
      clearInterval(musicProgressInterval);
      updatePlayButton();
      updateMusicBtnState();
    });
  }
}

/**
 * 初始化播放列表
 */
function initMusicPlaylist() {
  const playlistItems = document.getElementById("music-playlist-items");

  if (!playlistItems) return;

  playlistItems.innerHTML = "";

  MUSIC_PLAYLIST.forEach((song, index) => {
    const itemEl = document.createElement("div");
    itemEl.className = "playlist-item";
    itemEl.dataset.index = index;

    itemEl.innerHTML = `
      <div class="playlist-item-info">
        <div class="playlist-item-title">${song.title}</div>
        <div class="playlist-item-artist">${song.artist}</div>
      </div>
      <div class="playlist-item-duration">${song.duration}</div>
    `;

    itemEl.addEventListener("click", () => {
      const wasPlaying = isMusicPlaying;
      selectSong(index, wasPlaying); // 如果之前在播放，则自动播放新选择的歌曲
    });

    playlistItems.appendChild(itemEl);
  });

  if (MUSIC_PLAYLIST.length > 0) {
    const savedSong = readStoredPreference("mao-map:music-song");
    const savedIndex = MUSIC_PLAYLIST.findIndex(song => !song.isLocal && String(song.id) === savedSong);
    selectSong(savedIndex >= 0 ? savedIndex : 0, false); // 恢复选择，仍保持暂停
  }
}

/**
 * 更新播放按钮状态
 */
function updatePlayButton() {
  const playBtn = document.getElementById("music-play-btn");
  if (playBtn) {
    playBtn.innerHTML = window.JourneyIcons.svg(isMusicPlaying ? 'pause' : 'play');
    playBtn.title = i18n.t(isMusicPlaying ? 'ui.controls.pause' : 'ui.controls.play');
    playBtn.setAttribute('aria-label', playBtn.title);
    playBtn.setAttribute('aria-pressed', String(isMusicPlaying));
    playBtn.setAttribute('aria-busy', 'false');
  }
}

/**
 * 更新音乐按钮状态
 */
function updateMusicBtnState() {
  const musicBtn = document.getElementById("music-btn");
  if (musicBtn) {
    if (isMusicPlaying) {
      musicBtn.classList.add("playing");
    } else {
      musicBtn.classList.remove("playing");
    }
  }
  updateTimelineControlBackground();
  const song = MUSIC_PLAYLIST[currentMusicIndex];
  document.dispatchEvent(new CustomEvent('journey:music-change', {
    detail: { playing: isMusicPlaying, id: song?.id, isLocal: !!song?.isLocal },
  }));
}

/**
 * 开始进度更新
 */
function startProgressUpdate() {
  clearInterval(musicProgressInterval);
  musicProgressInterval = setInterval(() => {
    updateMusicProgress();
  }, 1000);
}

/**
 * 更新音乐进度
 */
function updateMusicProgress() {
  if (!musicAudio || !musicAudio.duration) return;

  const currentTime = musicAudio.currentTime;
  const duration = musicAudio.duration;
  const progress = (currentTime / duration) * 100;

  const progressFill = document.getElementById("music-progress-fill");
  if (progressFill) {
    progressFill.style.width = `${progress}%`;
  }

  const currentTimeEl = document.getElementById("music-current-time");
  const totalTimeEl = document.getElementById("music-total-time");

  if (currentTimeEl) {
    currentTimeEl.textContent = formatTime(currentTime);
  }

  if (totalTimeEl) {
    totalTimeEl.textContent = formatTime(duration);
  }
}

/**
 * 更新音乐总时长
 */
function updateMusicDuration() {
  if (!musicAudio || !musicAudio.duration) return;

  const totalTimeEl = document.getElementById("music-total-time");
  if (totalTimeEl) {
    totalTimeEl.textContent = formatTime(musicAudio.duration);
  }
}

/**
 * 处理进度条点击
 */
function handleProgressClick(e) {
  if (!musicAudio || !musicAudio.duration) return;

  const progressBar = e.currentTarget;
  const rect = progressBar.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const percentage = x / rect.width;
  const newTime = percentage * musicAudio.duration;

  musicAudio.currentTime = newTime;
  updateMusicProgress();
}

/**
 * 处理音频错误
 */
function handleMusicError(e) {
  console.error("音频播放错误:", e);
  showTemporaryMessage(i18n.t('messages.musicPlayError'), "warning");

  isMusicPlaying = false;
  clearInterval(musicProgressInterval);
  updatePlayButton();
  updateMusicBtnState();
}

/**
 * 格式化时间显示
 */
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

/**
 * 初始化音量控制
 */
function initVolumeControl() {
  const volumeSlider = document.getElementById("music-volume-slider");
  const volumeValue = document.getElementById("music-volume-value");

  if (volumeSlider) {
    volumeSlider.addEventListener("input", (e) => {
      const volume = parseInt(e.target.value) / 100;
      setMusicVolume(volume);
    });

    volumeSlider.value = musicVolume * 100;
    window.JourneyControls?.sync(volumeSlider);
  }

  if (volumeValue) {
    volumeValue.textContent = Math.round(musicVolume * 100) + "%";
  }
}

/**
 * 设置音乐音量
 */
function setMusicVolume(volume) {
  musicVolume = normalizePreferenceNumber(volume, musicVolume, 0, 1, 0.01);

  if (musicAudio) {
    musicAudio.volume = musicVolume;
  }

  const volumeSlider = document.getElementById("music-volume-slider");
  if (volumeSlider) {
    volumeSlider.value = String(Math.round(musicVolume * 100));
    window.JourneyControls?.sync(volumeSlider);
  }
  const volumeValue = document.getElementById("music-volume-value");
  if (volumeValue) {
    volumeValue.textContent = Math.round(musicVolume * 100) + "%";
  }

  writeStoredPreference("musicVolume", musicVolume);
}

/**
 * 初始化本地音乐上传
 */
function initMusicUpload() {
  const uploadBtn = document.getElementById("music-upload-btn");
  const fileInput = document.getElementById("music-file-input");

  if (uploadBtn) {
    uploadBtn.addEventListener("click", () => {
      fileInput?.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", handleMusicFileUpload);
  }
}

/**
 * 处理本地音乐文件上传
 */
function handleMusicFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith("audio/")) {
    showTemporaryMessage(i18n.t('messages.musicUploadError'), "warning");
    return;
  }

  const tempUrl = URL.createObjectURL(file);

  const tempSong = {
    id: "local_" + Date.now(),
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: "本地音乐",
    duration: "未知",
    urls: [tempUrl],
    isLocal: true,
  };

  MUSIC_PLAYLIST.push(tempSong);

  initMusicPlaylist();

  selectSong(MUSIC_PLAYLIST.length - 1, false); // 选择新上传的歌曲，但不自动播放

  showTemporaryMessage(i18n.t('messages.musicUploadSuccess'), "success");

  e.target.value = "";
}

/**
 * 从本地存储恢复音乐设置
 */
function restoreMusicSettings() {
  setMusicVolume(normalizePreferenceNumber(readStoredPreference("musicVolume"), 0.5, 0, 1, 0.01));
}

/**
 * 更新时间轴控制面板背景色
 */
function updateTimelineControlBackground() {
  // Playback owns one floating surface; browse mode has a separate footer.
  for (const id of ["playback-dock", "timeline-control", "music-modal", "music-btn"]) {
    document.getElementById(id)?.classList.toggle("music-playing", isMusicPlaying);
  }
}

// ==================== leaflet.motion 插件检查和性能优化 ====================
/**
 * 检查 leaflet.motion 插件是否正确加载
 */
function checkMotionPlugin() {
  if (
    typeof L.motion !== "undefined" &&
    typeof L.motion.polyline === "function"
  ) {
    console.log("✅ leaflet.motion 插件加载成功");
    return true;
  } else {
    console.error("❌ leaflet.motion 插件未正确加载");
    return false;
  }
}

/**
 * 清理 motion 资源
 */
function cleanupMotionResources() {
  const allPaths = Array.from(motionPaths.values());

  if (allPaths.length > 0) {
    batchAnimatePathsDisappear(allPaths, 100)
      .then(() => {
        motionPaths.clear();
        pathLayers = [];
        animationQueue = [];
        isAnimationInProgress = false;

        console.log("Motion 资源清理完成");
      })
      .catch((error) => {
        console.warn("Motion 资源清理失败:", error);
        motionPaths.forEach((path) => {
          if (path && path._map) {
            try {
              path.motionStop();
              map.removeLayer(path);
            } catch (e) {
              console.warn("强制清理路径失败:", e);
            }
          }
        });

        motionPaths.clear();
        pathLayers = [];
        animationQueue = [];
        isAnimationInProgress = false;
      });
  } else {
    motionPaths.clear();
    animationQueue = [];
    isAnimationInProgress = false;
    console.log("Motion 资源清理完成");
  }
}

/**
 * 预加载关键路径动画
 */
function preloadKeyAnimations() {
  if (!trajectoryData || !trajectoryData.events) return;

  // 获取当前语言环境的本地活动类型标识
  const locale = i18n.getCurrentLocale();
  const localActivityType = locale === 'en' ? 'Local Activity' : '原地活动';

  const keyEvents = trajectoryData.events.slice(
    0,
    Math.min(10, trajectoryData.events.length)
  );

  keyEvents.forEach((event, index) => {
    if (
      event.startCoords &&
      event.endCoords &&
      event.movementType !== localActivityType
    ) {
      const preloadPath = createMotionPath(
        event.startCoords,
        event.endCoords,
        event.transitCoords,
        false,
        index,
        false,
        false
      );

      if (preloadPath) {
        preloadPath.addTo(map);
        preloadPath.setStyle({ opacity: 0 });

        setTimeout(() => {
          if (preloadPath._map) {
            map.removeLayer(preloadPath);
          }
        }, 100);
      }
    }
  });

  console.log("关键路径预加载完成");
}

/**
 * 优化 motion 性能配置
 */
function optimizeMotionPerformance() {
  if (!map || !map._renderer) {
    console.warn("地图未完全初始化，跳过性能优化");
    return;
  }

  try {
    const renderer = map._renderer;
    if (renderer && renderer._container) {
      const container = renderer._container;

      container.style.willChange = "transform";
      container.style.transform = "translateZ(0)";
      container.style.backfaceVisibility = "hidden";

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeName === "path" && node.getAttribute("stroke")) {
                node.style.willChange = "stroke-dashoffset";
                node.style.transform = "translateZ(0)";
              }
            });
          }
        });
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
      });

      window.motionObserver = observer;

      console.log("Motion 性能优化已启用");
    }
  } catch (error) {
    console.warn("Motion 性能优化失败:", error);
  }
}

/**
 * 动态调整 motion 参数
 */
function dynamicAdjustMotionParams() {
  const pathCount = motionPaths.size;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const isMobile = isMobileDevice();

  let durationMultiplier = 1;

  if (pathCount > 20) {
    durationMultiplier = 0.7;
  } else if (pathCount > 10) {
    durationMultiplier = 0.85;
  }

  if (isMobile) {
    durationMultiplier *= 0.8;
  }

  if (devicePixelRatio > 2) {
    durationMultiplier *= 0.9;
  }

  animationConfig.pathDuration = Math.max(
    1000,
    animationConfig.pathDuration * durationMultiplier
  );
}

/**
 * 监听性能指标
 */
function monitorMotionPerformance() {
  let frameCount = 0;
  let lastTime = Date.now();
  let isMonitoring = false;

  function measureFPS() {
    if (!isMonitoring) return;

    frameCount++;
    const currentTime = Date.now();

    if (currentTime - lastTime >= 1000) {
      const fps = frameCount;
      frameCount = 0;
      lastTime = currentTime;

      // 如果 FPS 过低，自动调整参数
      if (fps < 30 && motionPaths.size > 0) {
        console.warn("Motion 性能较低，自动调整参数");
        dynamicAdjustMotionParams();
      }

      if (motionPaths.size > 0) {
        console.log(
          `Motion 性能监控 - FPS: ${fps}, 路径数量: ${motionPaths.size}`
        );
      }
    }

    if (motionPaths.size > 0 && isMonitoring) {
      requestAnimationFrame(measureFPS);
    }
  }

  isMonitoring = true;
  if (motionPaths.size > 0) {
    requestAnimationFrame(measureFPS);
  }

  return {
    stop: () => {
      isMonitoring = false;
    },
  };
}

// ==================== 事件绑定 ====================
/**
 * 绑定所有事件监听器
 */
function bindEvents() {
  const playBtn = document.getElementById("play-btn");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");

  if (playBtn) playBtn.addEventListener("click", togglePlay);
  if (prevBtn) prevBtn.addEventListener("click", previousEvent);
  if (nextBtn) nextBtn.addEventListener("click", nextEvent);

  const slider = document.getElementById("timeline-slider");
  if (slider) {
    let dragPointerId = null;
    function finishDrag(commit) {
      if (!isDragging) return;
      const index = Number(slider.value);
      isDragging = false;
      const pointerId = dragPointerId;
      dragPointerId = null;
      if (pointerId !== null && slider.hasPointerCapture?.(pointerId)) slider.releasePointerCapture(pointerId);
      if (commit) goToJourneyEvent(index);
      else {
        slider.value = currentEventIndex;
        updateCurrentEventInfo(trajectoryData.events[currentEventIndex]);
        updateProgress();
        publishJourneyEvent();
      }
    }
    slider.addEventListener("pointerdown", (event) => {
      if (!trajectoryData || event.button !== 0) return;
      stopPlayback();
      isDragging = true;
      dragPointerId = event.pointerId;
      slider.setPointerCapture?.(event.pointerId);
    });
    slider.addEventListener("pointerup", () => finishDrag(true));
    slider.addEventListener("pointercancel", () => finishDrag(false));
    slider.addEventListener("lostpointercapture", () => finishDrag(false));
    slider.addEventListener("blur", () => finishDrag(false));
    window.addEventListener("blur", () => finishDrag(false));

    slider.addEventListener("input", (e) => {
      if (trajectoryData) {
        const newIndex = parseInt(e.target.value);

        if (isDragging) {
          // 拖动过程中只更新文字信息，不重建路径（避免卡顿和闪烁）
          updateDragPreview(newIndex);
        } else {
          // 非拖动（如键盘方向键触发的 input）：完整更新
          goToJourneyEvent(newIndex);
        }
      }
    });

    slider.addEventListener("dblclick", (e) => {
      e.preventDefault();
      copyCurrentEventData();
    });

    slider.addEventListener("change", () => {
      if (!isDragging && Number(slider.value) !== currentEventIndex) goToJourneyEvent(Number(slider.value));
    });
  }

  document.addEventListener("keydown", (e) => {
    const activeElement = document.activeElement;
    const isInputElement =
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.tagName === "SELECT" ||
        activeElement.contentEditable === "true");

    const detailPanel = document.getElementById("location-detail-panel");
    const isPanelVisible =
      detailPanel && detailPanel.classList.contains("visible");

    if (!isInputElement && !isPanelVisible) {
      handleTimelineKeydown(e);
    }
  });

  const playbackSpeed = document.getElementById("playback-speed");
  if (playbackSpeed) {
    playbackSpeed.addEventListener("change", () => {
      applySpeedPreset(Number(playbackSpeed.value));
    });
  }

  initAnimationControls();
  initStatsHover();
  initDetailPanel();
  initMobileInteractions();
  initFeedbackModal();
  initCameraFollowControl();
  initMusicPlayer();

  restoreMusicSettings();

  window.addEventListener("resize", () => {
    const mapEl = document.getElementById("map");
    if (isMobileDevice()) {
      if (isPanelVisible) {
        mapEl.classList.remove("panel-hidden");
        mapEl.classList.add("panel-visible");
      } else {
        mapEl.classList.remove("panel-visible");
        mapEl.classList.add("panel-hidden");
      }
    } else {
      mapEl.classList.remove("panel-hidden", "panel-visible");
      isPanelVisible = true;
      document.getElementById("timeline-control")?.classList.remove("hidden");
    }
    map?.invalidateSize({ animate: false, pan: false });
  });
}

// ==================== 启动应用 ====================
/**
 * 修改初始化应用函数，添加插件检查
 */
async function initApp() {
  try {
    // 初始化多语言支持
    await initI18n();

    initMap();
    initMapInteractionDetection();

    const motionLoaded = checkMotionPlugin();
    if (!motionLoaded) {
      throw new Error(
        "leaflet.motion 插件未正确加载，请确保已正确引入插件文件"
      );
    }

    // 等待地图完全加载
    await new Promise((resolve) => {
      if (map._loaded) {
        resolve();
      } else {
        map.on("load", resolve);
        setTimeout(resolve, 2000);
      }
    });

    const geoDataLoaded = await loadGeographicData();
    if (!geoDataLoaded) {
      throw new Error("地理数据加载失败");
    }

    trajectoryData = await loadTrajectoryData();

    if (trajectoryData && trajectoryData.events.length > 0) {
      syncTimelineBounds();
      publishJourneyData();
      updateStatistics();
      bindEvents();
      showEventAtIndex(0, false, true);
    } else {
      throw new Error("轨迹数据为空");
    }

    hideLoading();

    const mapEl = document.getElementById("map");
    if (isMobileDevice()) {
      mapEl.classList.add("panel-visible");
    }

    window.addEventListener("beforeunload", () => {
      stopPlayback();
      clearTimeout(userInteractionTimeout);
      clearTimeout(mapCameraTimeout);
      cleanupMotionResources();
      if (window.motionObserver) {
        window.motionObserver.disconnect();
      }
      if (window.motionPerformanceMonitor) {
        window.motionPerformanceMonitor.stop();
      }
    });

    console.log("leaflet.motion 插件状态:", motionLoaded ? "已加载" : "未加载");
  } catch (error) {
    console.error("应用初始化失败:", error);

    const loading = document.getElementById("loading");
    if (loading) {
      const isEnglish = i18n.getCurrentLocale() === "en";
      loading.innerHTML = `
        <div class="error" role="alert">
          <h3>${isEnglish ? "Unable to load the journey" : "足迹资料暂未加载成功"}</h3>
          <p>${isEnglish ? "Check your connection, then try again." : "请检查网络连接后重试。"}</p>
          <details><summary>${isEnglish ? "Details" : "查看原因"}</summary><p>${escapeHtml(error.message)}</p></details>
          <button id="loading-retry-btn" type="button">${isEnglish ? "Retry" : "重新加载"}</button>
        </div>
      `;
      document.getElementById("loading-retry-btn")?.addEventListener("click", () => window.location.reload());
    }
  }
}

// ==================== 启动应用 ====================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
