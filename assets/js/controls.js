/* Shared controls retain native values and events while using the current skin. */
(() => {
  'use strict';

  const selectIds = ['playback-speed', 'skin-select', 'period-select'];
  const controls = new Map();
  const triggers = new Map();
  const navigationKeys = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' ', 'Escape']);
  const selectKeys = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ']);
  let opened = null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const canFocus = element => element.isConnected && !element.disabled && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0;
  const enabledIndices = control => control.options.flatMap((option, index) => option.disabled || option.hidden ? [] : [index]);

  function close(restoreFocus = false) {
    if (!opened) return;
    const control = opened;
    opened = null;
    control.popup.hidden = true;
    control.trigger.setAttribute('aria-expanded', 'false');
    control.trigger.removeAttribute('aria-activedescendant');
    control.wrapper.classList.remove('is-open');
    if (restoreFocus && canFocus(control.trigger)) control.trigger.focus({ preventScroll: true });
  }

  function syncRange(range) {
    const min = Number(range.min || 0);
    const max = Number(range.max || 100);
    const value = Number(range.value);
    const progress = Number.isFinite(value) && max > min ? clamp((value - min) / (max - min) * 100, 0, 100) : 0;
    range.style.setProperty('--range-progress', `${Math.round(progress * 1000) / 1000}%`);
  }

  function scrollActiveIntoView(control) {
    const option = control.popup.querySelector(`[data-index="${control.activeIndex}"]`);
    if (!option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    const height = control.popup.clientHeight;
    if (top < control.popup.scrollTop) control.popup.scrollTop = top;
    else if (height && bottom > control.popup.scrollTop + height) control.popup.scrollTop = bottom - height;
  }

  function updateOptions(control, scroll = false) {
    control.popup.querySelectorAll('.select-option').forEach(option => {
      const index = Number(option.dataset.index);
      option.setAttribute('aria-selected', String(index === control.native.selectedIndex));
      option.classList.toggle('is-active', opened === control && index === control.activeIndex);
    });
    if (opened === control && control.activeIndex >= 0) {
      control.trigger.setAttribute('aria-activedescendant', `${control.native.id}-option-${control.activeIndex}`);
      if (scroll) scrollActiveIntoView(control);
    }
  }

  function syncControl(control) {
    const native = control.native;
    const previousValue = control.lastValue;
    control.options = [...native.options].map(option => ({
      value: option.value,
      label: option.label,
      disabled: option.disabled || !!option.closest('optgroup[disabled]'),
      hidden: option.hidden || !!option.closest('optgroup[hidden]'),
    }));
    const signature = JSON.stringify(control.options);
    const optionsChanged = signature !== control.signature;
    if (optionsChanged) {
      control.signature = signature;
      const fragment = document.createDocumentFragment();
      control.options.forEach((option, index) => {
        if (option.hidden) return;
        const item = document.createElement('div');
        item.className = 'select-option';
        item.id = `${native.id}-option-${index}`;
        item.dataset.value = option.value;
        item.dataset.index = String(index);
        item.setAttribute('role', 'option');
        item.setAttribute('aria-disabled', String(option.disabled));
        const check = document.createElement('span');
        check.className = 'select-option-check';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = window.JourneyIcons.svg('check');
        const label = document.createElement('span');
        label.className = 'select-option-label';
        label.textContent = option.label;
        item.title = option.label;
        item.append(check, label);
        fragment.append(item);
      });
      control.popup.replaceChildren(fragment);
    }

    const indices = enabledIndices(control);
    const selected = control.options[native.selectedIndex];
    const valueText = selected?.label || '';
    control.value.textContent = valueText;
    control.trigger.disabled = native.disabled || indices.length === 0;
    control.trigger.setAttribute('aria-disabled', String(control.trigger.disabled));
    control.trigger.title = native.title || valueText;
    control.lastValue = native.value;

    const labelIds = native.getAttribute('aria-labelledby') || control.labels.map(label => label.id).join(' ');
    if (labelIds) {
      control.trigger.setAttribute('aria-labelledby', `${labelIds} ${control.value.id}`);
      control.trigger.removeAttribute('aria-label');
      control.popup.setAttribute('aria-labelledby', labelIds);
      control.popup.removeAttribute('aria-label');
    } else {
      const label = native.getAttribute('aria-label') || native.id;
      control.trigger.setAttribute('aria-label', `${label}：${valueText}`);
      control.trigger.removeAttribute('aria-labelledby');
      control.popup.setAttribute('aria-label', label);
      control.popup.removeAttribute('aria-labelledby');
    }
    const description = native.getAttribute('aria-describedby');
    if (description) control.trigger.setAttribute('aria-describedby', description);
    else control.trigger.removeAttribute('aria-describedby');

    if (previousValue !== native.value || !indices.includes(control.activeIndex)) {
      control.activeIndex = indices.includes(native.selectedIndex) ? native.selectedIndex : indices[0] ?? -1;
    }
    if (opened === control && (control.trigger.disabled || !canFocus(control.trigger))) close();
    updateOptions(control);
    if (opened === control && (optionsChanged || previousValue !== native.value)) position(control);
  }

  function viewportBounds() {
    // Resolve shared insets to pixels, including the native Android fallback.
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:var(--safe-top,0px) var(--safe-right,0px) var(--safe-bottom,0px) var(--safe-left,0px);';
    document.body.append(probe);
    const computed = getComputedStyle(probe);
    const inset = ['Top', 'Right', 'Bottom', 'Left'].map(side => Number.parseFloat(computed[`padding${side}`]) || 0);
    probe.remove();
    const visual = window.visualViewport;
    const left = visual?.offsetLeft || 0;
    const top = visual?.offsetTop || 0;
    const width = visual?.width || window.innerWidth;
    const height = visual?.height || window.innerHeight;
    const titlebar = Number.parseFloat(getComputedStyle(document.body).getPropertyValue('--titlebar-height')) || 0;
    return {
      left: left + inset[3] + 8,
      right: left + width - inset[1] - 8,
      top: Math.max(top, titlebar) + inset[0] + 8,
      bottom: top + height - inset[2] - 8,
    };
  }

  function position(control) {
    const rect = control.trigger.getBoundingClientRect();
    const bounds = viewportBounds();
    const popup = control.popup;
    const availableWidth = Math.max(1, bounds.right - bounds.left);
    // Measure complete labels independently of the narrow trigger. An earlier
    // constrained width must not become the next opening's intrinsic width.
    popup.style.minWidth = '';
    popup.style.maxWidth = 'none';
    popup.style.width = 'max-content';
    popup.style.maxHeight = 'none';
    const styles = getComputedStyle(popup);
    const pixels = property => Number.parseFloat(styles[property]) || 0;
    const chromeWidth = pixels('paddingLeft') + pixels('paddingRight') + pixels('borderLeftWidth') + pixels('borderRightWidth');
    const minimumWidth = Math.max(rect.width, pixels('minWidth'));
    const optionWidth = Math.max(0, ...[...popup.querySelectorAll('.select-option')].map(option => {
      const label = option.querySelector('.select-option-label');
      // Include the real checkmark, gap and padding, then restore any clipped text.
      return option.getBoundingClientRect().width + Math.max(0, label.scrollWidth - label.getBoundingClientRect().width);
    }));
    const measuredWidth = Math.max(popup.getBoundingClientRect().width, optionWidth + chromeWidth);
    const width = Math.min(availableWidth, Math.ceil(Math.max(minimumWidth, measuredWidth)));
    popup.style.minWidth = `${Math.min(minimumWidth, availableWidth)}px`;
    popup.style.maxWidth = `${availableWidth}px`;
    popup.style.width = `${width}px`;
    // scrollHeight excludes borders, whereas max-height uses border-box sizing.
    // Count both borders so a fully fitting menu does not acquire a 2px scrollbar.
    const borderHeight = pixels('borderTopWidth') + pixels('borderBottomWidth');
    const fullHeight = Math.max(popup.scrollHeight + borderHeight, popup.getBoundingClientRect().height);
    const naturalHeight = Math.min(320, Math.ceil(fullHeight || control.options.length * 44 + 12));
    const above = Math.max(0, rect.top - bounds.top - 6);
    const below = Math.max(0, bounds.bottom - rect.bottom - 6);
    const openAbove = control.native.id === 'playback-speed'
      ? above >= naturalHeight || above >= below
      : below < naturalHeight && above > below;
    const height = Math.min(naturalHeight, openAbove ? above : below);
    popup.style.maxHeight = `${Math.max(1, height)}px`;
    popup.style.left = `${clamp(rect.left, bounds.left, bounds.right - width)}px`;
    popup.style.top = `${clamp(openAbove ? rect.top - height - 6 : rect.bottom + 6, bounds.top, Math.max(bounds.top, bounds.bottom - height))}px`;
    popup.dataset.placement = openAbove ? 'top' : 'bottom';
  }

  function open(control, boundary) {
    syncControl(control);
    if (control.trigger.disabled || !canFocus(control.trigger)) return;
    if (opened && opened !== control) close();
    const indices = enabledIndices(control);
    control.activeIndex = boundary === 'first' ? indices[0] : boundary === 'last' ? indices.at(-1)
      : indices.includes(control.native.selectedIndex) ? control.native.selectedIndex : indices[0];
    opened = control;
    control.popup.hidden = false;
    control.trigger.setAttribute('aria-expanded', 'true');
    control.wrapper.classList.add('is-open');
    control.trigger.focus({ preventScroll: true });
    position(control);
    updateOptions(control, true);
  }

  function commit(control, index) {
    const option = control.options[index];
    if (!option || option.disabled || option.hidden || control.native.disabled) return;
    const changed = control.native.value !== option.value;
    control.native.value = option.value;
    if (changed) control.native.dispatchEvent(new Event('change', { bubbles: true }));
    syncControl(control);
    close(true);
  }

  function enhance(native) {
    if (controls.has(native)) return controls.get(native);
    const labels = [...native.labels];
    labels.forEach((label, index) => { if (!label.id) label.id = `${native.id}-label-${index}`; });
    const wrapper = document.createElement('div');
    wrapper.className = 'select-control';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = `${native.id}-trigger`;
    trigger.className = 'select-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${native.id}-listbox`);
    const value = document.createElement('span');
    value.className = 'select-value';
    value.id = `${native.id}-value`;
    const chevron = document.createElement('span');
    chevron.className = 'select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = window.JourneyIcons.svg('chevron-down');
    trigger.append(value, chevron);
    native.before(wrapper);
    wrapper.append(native, trigger);
    native.hidden = true;
    labels.forEach(label => { if (label.htmlFor === native.id) label.htmlFor = trigger.id; });

    const popup = document.createElement('div');
    popup.id = `${native.id}-listbox`;
    popup.className = 'select-popup';
    popup.setAttribute('role', 'listbox');
    popup.hidden = true;
    popup.style.position = 'fixed';
    popup.style.boxSizing = 'border-box';
    document.body.append(popup);
    const control = { native, wrapper, trigger, value, popup, labels, options: [], activeIndex: -1, signature: null, lastValue: undefined };
    controls.set(native, control);
    triggers.set(trigger, control);

    trigger.addEventListener('click', () => opened === control ? close() : open(control));
    native.addEventListener('change', () => syncControl(control));
    popup.addEventListener('pointerdown', event => {
      if (event.target.closest('.select-option')) event.preventDefault();
    });
    popup.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      const option = event.target.closest('.select-option');
      const index = Number(option?.dataset.index);
      if (option && !control.options[index].disabled && control.activeIndex !== index) {
        control.activeIndex = index;
        updateOptions(control);
      }
    });
    popup.addEventListener('click', event => {
      // A body portal is outside settings-panel; do not dismiss its owner dialog.
      event.stopPropagation();
      const option = event.target.closest('.select-option');
      if (option) commit(control, Number(option.dataset.index));
    });
    new MutationObserver(() => syncControl(control)).observe(native, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['disabled', 'hidden', 'label', 'value', 'selected', 'aria-label', 'aria-labelledby', 'aria-describedby', 'title'],
    });
    syncControl(control);
    return control;
  }

  function sync(target) {
    if (target === undefined || target === null) {
      selectIds.forEach(id => { const native = document.getElementById(id); if (native) syncControl(enhance(native)); });
      document.querySelectorAll('input[type="range"]').forEach(syncRange);
      return;
    }
    const element = typeof target === 'string' ? document.getElementById(target.replace(/^#/, '')) : target;
    if (!element) return;
    if (element.matches('input[type="range"]')) syncRange(element);
    else if (controls.has(element)) syncControl(controls.get(element));
    else if (triggers.has(element)) syncControl(triggers.get(element));
    else if (element.matches('select') && selectIds.includes(element.id)) syncControl(enhance(element));
  }

  // Registered before journey.js so a dropdown handles Escape before its dialog.
  document.addEventListener('keydown', event => {
    if (navigationKeys.has(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) document.body.dataset.inputMode = 'keyboard';
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const control = triggers.get(event.target.closest?.('.select-trigger'));
    if (!control) return;
    if (opened === control && event.key === 'Tab') { close(); return; }
    if (opened === control && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
      return;
    }
    if (!selectKeys.has(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (control.trigger.disabled) return;
    if (opened !== control) {
      open(control, event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : undefined);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { commit(control, control.activeIndex); return; }
    const indices = enabledIndices(control);
    const current = indices.indexOf(control.activeIndex);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? indices.length - 1
      : clamp(current + (event.key === 'ArrowUp' ? -1 : 1), 0, indices.length - 1);
    control.activeIndex = indices[next];
    updateOptions(control, true);
  }, true);

  function outside(event) {
    if (opened && !opened.wrapper.contains(event.target) && !opened.popup.contains(event.target)) close();
  }
  document.addEventListener('pointerdown', event => { document.body.dataset.inputMode = 'pointer'; outside(event); }, true);
  document.addEventListener('click', outside, true);
  document.addEventListener('focusin', outside, true);
  document.addEventListener('focusout', event => {
    if (opened?.trigger === event.target && event.relatedTarget !== opened.trigger) close();
  }, true);
  const onScroll = event => {
    if (opened && !(event.target instanceof Node && opened.popup.contains(event.target))) close();
  };
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', () => close());
  window.addEventListener('blur', () => close());
  window.visualViewport?.addEventListener('resize', () => close());
  window.visualViewport?.addEventListener('scroll', () => close());
  ['input', 'change'].forEach(type => document.addEventListener(type, event => {
    if (event.target.matches?.('input[type="range"]')) syncRange(event.target);
  }, true));
  document.addEventListener('journey:locale-change', () => sync());

  window.JourneyControls = Object.freeze({ sync, close: () => close() });
  sync();
})();
