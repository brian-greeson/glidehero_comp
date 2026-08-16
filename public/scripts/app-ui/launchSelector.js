const DEFAULT_ENDPOINT = '/v1/map-launches/options';
const DEFAULT_DEBOUNCE_MS = 200;

export function launchOptionsUrl(endpoint = DEFAULT_ENDPOINT, { query, viewport } = {}) {
  const parameters = new URLSearchParams();
  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  if (trimmedQuery) {
    parameters.set('q', trimmedQuery);
  } else if (viewport) {
    for (const key of ['west', 'south', 'east', 'north']) {
      const value = Number(viewport[key]);
      if (!Number.isFinite(value)) throw new TypeError(`Viewport ${key} must be a finite number.`);
      parameters.set(key, String(value));
    }
  } else {
    throw new TypeError('A query or viewport is required.');
  }
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}${parameters.toString()}`;
}

export function normalizeLaunchOption(value) {
  const launchId = Number(value?.launchId ?? value?.id);
  const longitude = Number(value?.longitude);
  const latitude = Number(value?.latitude);
  if (!Number.isInteger(launchId) || launchId <= 0 || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const name = String(value?.name ?? '').trim();
  if (!name) return null;
  return {
    launchId,
    name,
    state: String(value?.state ?? '').trim(),
    country: String(value?.country ?? '').trim(),
    longitude,
    latitude,
  };
}

export function launchSecondaryLabel(launch) {
  return [launch?.state, launch?.country].map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');
}

export function initializeLaunchSelector({
  documentRef = document,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  getViewport,
  onSelect = () => {},
  endpoint = DEFAULT_ENDPOINT,
  debounceMs = DEFAULT_DEBOUNCE_MS,
} = {}) {
  const root = documentRef.querySelector?.('[data-launch-selector]');
  if (!root) return null;

  const trigger = root.querySelector('[data-launch-selector-trigger]');
  const label = root.querySelector('[data-launch-selector-label]');
  const popover = root.querySelector('[data-launch-selector-popover]');
  const input = root.querySelector('[data-launch-selector-input]');
  const options = root.querySelector('[data-launch-selector-options]');
  const results = root.querySelector('[data-launch-selector-results]');
  const status = root.querySelector('[data-launch-selector-status]');
  const allOption = root.querySelector('[data-launch-selector-option="all"]');
  const unknownOption = root.querySelector('[data-launch-selector-option="unknown"]');
  if (!trigger || !label || !popover || !input || !options || !results || !status || !allOption || !unknownOption) return null;

  let open = false;
  let timer = null;
  let requestVersion = 0;
  let requestController = null;
  let activeIndex = -1;
  let selected = { type: 'all' };
  let destroyed = false;

  function selectableOptions() {
    return Array.from(options.querySelectorAll('[role="option"]'));
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function setActive(index) {
    const items = selectableOptions();
    if (!items.length) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    activeIndex = ((index % items.length) + items.length) % items.length;
    items.forEach((item, itemIndex) => item.classList.toggle('is-active', itemIndex === activeIndex));
    const active = items[activeIndex];
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView?.({ block: 'nearest' });
  }

  function clearActive() {
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');
    for (const item of selectableOptions()) item.classList.remove('is-active');
  }

  function markSelected() {
    for (const option of selectableOptions()) {
      let isSelected = false;
      if (selected.type === 'all') isSelected = option.dataset.launchSelectorOption === 'all';
      if (selected.type === 'unknown') isSelected = option.dataset.launchSelectorOption === 'unknown';
      if (selected.type === 'launch') isSelected = option.dataset.launchId === String(selected.launch.launchId);
      option.setAttribute('aria-selected', String(isSelected));
    }
  }

  function setSelection(nextSelection, { notify = false, close = false } = {}) {
    if (!nextSelection || !['all', 'unknown', 'launch'].includes(nextSelection.type)) return;
    if (nextSelection.type === 'launch') {
      const launch = normalizeLaunchOption(nextSelection.launch);
      if (!launch) return;
      selected = { type: 'launch', launch };
      label.textContent = launch.name;
    } else {
      selected = { type: nextSelection.type };
      label.textContent = nextSelection.type === 'unknown' ? 'Unknown launch' : 'Launches';
    }
    markSelected();
    if (notify) onSelect(selected);
    if (close) closePopover({ restoreFocus: true });
  }

  function renderLaunches(rawLaunches) {
    results.replaceChildren();
    const launches = (Array.isArray(rawLaunches) ? rawLaunches : []).map(normalizeLaunchOption).filter(Boolean).slice(0, 25);
    for (const launch of launches) {
      const option = documentRef.createElement('button');
      option.type = 'button';
      option.id = `launch-selector-option-${launch.launchId}`;
      option.dataset.launchSelectorOption = 'launch';
      option.dataset.launchId = String(launch.launchId);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');

      const primary = documentRef.createElement('span');
      primary.className = 'launch-selector__option-name';
      primary.textContent = launch.name;
      option.append(primary);
      const context = launchSecondaryLabel(launch);
      if (context) {
        const secondary = documentRef.createElement('small');
        secondary.className = 'launch-selector__option-context';
        secondary.textContent = context;
        option.append(secondary);
      }
      option.__launchOption = launch;
      results.append(option);
    }
    clearActive();
    markSelected();
    setStatus(launches.length ? `${launches.length} launch${launches.length === 1 ? '' : 'es'} available.` : 'No launches found.');
  }

  function cancelPending() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    requestVersion += 1;
    requestController?.abort();
    requestController = null;
  }

  async function requestLaunches(mode) {
    if (!fetchImpl || destroyed) return;
    cancelPending();
    const version = requestVersion;
    requestController = typeof AbortController === 'function' ? new AbortController() : null;
    setStatus('Loading launches…');
    try {
      const url = mode.query
        ? launchOptionsUrl(endpoint, { query: mode.query })
        : launchOptionsUrl(endpoint, { viewport: getViewport?.() });
      const response = await fetchImpl(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        ...(requestController ? { signal: requestController.signal } : {}),
      });
      if (!response.ok) throw new Error(`Launch request failed with ${response.status}.`);
      const payload = await response.json();
      if (destroyed || version !== requestVersion) return;
      renderLaunches(payload?.launches);
    } catch (error) {
      if (destroyed || version !== requestVersion || error?.name === 'AbortError') return;
      results.replaceChildren();
      clearActive();
      setStatus('Launches could not be loaded.');
    }
  }

  function loadForInput() {
    const query = input.value.trim();
    cancelPending();
    results.replaceChildren();
    clearActive();
    if (!query) {
      void requestLaunches({ viewport: true });
      return;
    }
    if (query.length === 1) {
      setStatus('Type at least 2 characters.');
      return;
    }
    setStatus('Waiting to search…');
    timer = setTimeout(() => {
      timer = null;
      void requestLaunches({ query });
    }, Math.max(0, Number(debounceMs) || 0));
  }

  function openPopover() {
    if (open || destroyed) return;
    open = true;
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-expanded', 'true');
    input.focus?.();
    loadForInput();
  }

  function closePopover({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false;
    cancelPending();
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-expanded', 'false');
    clearActive();
    if (restoreFocus) trigger.focus?.();
  }

  function selectOption(option) {
    const kind = option?.dataset?.launchSelectorOption;
    if (kind === 'all' || kind === 'unknown') setSelection({ type: kind }, { notify: true, close: true });
    else if (kind === 'launch' && option.__launchOption) setSelection({ type: 'launch', launch: option.__launchOption }, { notify: true, close: true });
  }

  function handleTriggerClick() {
    if (open) closePopover(); else openPopover();
  }

  function handleInput() {
    loadForInput();
  }

  function handleKeydown(event) {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openPopover();
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex < 0 ? selectableOptions().length - 1 : activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectOption(selectableOptions()[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePopover({ restoreFocus: true });
    } else if (event.key === 'Tab') {
      closePopover();
    }
  }

  function handleOptionsClick(event) {
    const option = event.target?.closest?.('[role="option"]');
    if (option && options.contains(option)) selectOption(option);
  }

  function handleOptionsPointerMove(event) {
    const option = event.target?.closest?.('[role="option"]');
    if (!option || !options.contains(option)) return;
    const index = selectableOptions().indexOf(option);
    if (index >= 0) setActive(index);
  }

  function handleDocumentPointerDown(event) {
    if (open && !root.contains(event.target)) closePopover();
  }

  function handleFocusOut() {
    setTimeout(() => {
      if (open && !root.contains(documentRef.activeElement)) closePopover();
    }, 0);
  }

  trigger.addEventListener('click', handleTriggerClick);
  root.addEventListener('keydown', handleKeydown);
  root.addEventListener('focusout', handleFocusOut);
  input.addEventListener('input', handleInput);
  options.addEventListener('click', handleOptionsClick);
  options.addEventListener('pointermove', handleOptionsPointerMove);
  documentRef.addEventListener?.('pointerdown', handleDocumentPointerDown);

  function refreshViewport() {
    if (open && !input.value.trim()) void requestLaunches({ viewport: true });
  }

  function destroy() {
    destroyed = true;
    cancelPending();
    trigger.removeEventListener('click', handleTriggerClick);
    root.removeEventListener('keydown', handleKeydown);
    root.removeEventListener('focusout', handleFocusOut);
    input.removeEventListener('input', handleInput);
    options.removeEventListener('click', handleOptionsClick);
    options.removeEventListener('pointermove', handleOptionsPointerMove);
    documentRef.removeEventListener?.('pointerdown', handleDocumentPointerDown);
  }

  return {
    open: openPopover,
    close: closePopover,
    setSelection,
    refreshViewport,
    destroy,
    getSelection: () => selected,
  };
}
