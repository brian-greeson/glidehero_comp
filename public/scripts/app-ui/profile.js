/**
 * Progressive profile lists. The server renders every row for no-JS users;
 * initialization hides only rows explicitly marked as extra.
 */
export async function requestGliderMatches(query, fetchImpl = fetch) {
  const response = await fetchImpl(`/profile/glider/search?q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Glider search failed.');
  return response.json();
}

export function initializeProfileLists(documentRef = document) {
  for (const toggle of documentRef.querySelectorAll('[data-profile-list-toggle]')) {
    const listName = toggle.dataset.profileListToggle;
    const list = listName ? documentRef.querySelector(`[data-profile-list="${listName}"]`) : null;
    if (!list) continue;
    const extras = [...list.querySelectorAll('[data-profile-list-item="extra"]')];
    if (!extras.length) {
      toggle.hidden = true;
      continue;
    }
    for (const item of extras) item.hidden = true;
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      for (const item of extras) item.hidden = expanded;
      toggle.setAttribute('aria-expanded', String(!expanded));
      toggle.textContent = expanded ? 'Show all' : 'Show fewer';
    });
  }
  const card = documentRef.querySelector('[data-glider-card]');
  if (!card) return;
  const edit = card.querySelector('[data-glider-edit]');
  const form = card.querySelector('[data-glider-form]');
  const display = card.querySelector('[data-glider-display]');
  const cancel = card.querySelector('[data-glider-cancel]');
  const modelInput = card.querySelector('[data-glider-model]');
  const results = card.querySelector('[data-glider-results]');
  const gliderModelId = card.querySelector('[data-glider-model-id]');
  const manufacturer = card.querySelector('[data-glider-manufacturer]');
  const modelValue = card.querySelector('[data-glider-model-value]');
  const size = card.querySelector('[data-glider-size]');
  const rating = card.querySelector('[data-glider-rating]');
  const status = card.querySelector('[data-glider-search-status]');
  const resetConfirmation = card.querySelector('[data-glider-reset-confirmation]');
  if (!(edit instanceof HTMLElement) || !(form instanceof HTMLElement) || !(modelInput instanceof HTMLInputElement)) return;
  const resetRadios = [...form.querySelectorAll('input[name="resetHours"]')];
  let timer;
  let searchSequence = 0;
  if (resetConfirmation instanceof HTMLElement) resetConfirmation.hidden = true;

  function showEditor() {
    form.hidden = false;
    if (display instanceof HTMLElement) display.hidden = true;
    modelInput.focus();
  }

  function closeResults() {
    if (results instanceof HTMLElement) {
      results.hidden = true;
      results.replaceChildren();
    }
    modelInput.setAttribute('aria-expanded', 'false');
    modelInput.removeAttribute('aria-activedescendant');
  }

  function invalidateSearch() {
    clearTimeout(timer);
    searchSequence += 1;
  }

  function populateSizes(sizes, selectedValue = '') {
    if (!(size instanceof HTMLSelectElement)) return;
    size.replaceChildren(new Option('Select size', ''));
    for (const item of sizes) {
      const option = new Option(item.value, item.value, false, item.value === selectedValue);
      option.dataset.modelId = item.id;
      option.dataset.rating = item.enRating;
      size.add(option);
    }
    size.disabled = false;
    const selected = size.selectedOptions[0];
    if (gliderModelId instanceof HTMLInputElement) gliderModelId.value = selected?.dataset.modelId || '';
    if (rating) rating.textContent = selected?.dataset.rating || 'Select a size';
  }

  async function fetchMatches(query) {
    return requestGliderMatches(query);
  }

  async function hydrateCurrentSizes() {
    const selectedManufacturer = manufacturer instanceof HTMLInputElement ? manufacturer.value : '';
    const selectedModel = modelValue instanceof HTMLInputElement ? modelValue.value : '';
    if (!selectedManufacturer || !selectedModel) return;
    try {
      const items = await fetchMatches(`${selectedManufacturer} ${selectedModel}`);
      const exact = items.find((item) => item.manufacturer === selectedManufacturer && item.model === selectedModel);
      if (exact) populateSizes(exact.sizes, size instanceof HTMLSelectElement ? size.value : '');
    } catch {
      // The persisted option remains usable if enhancement-time search is unavailable.
    }
  }

  edit.addEventListener('click', () => {
    showEditor();
    void hydrateCurrentSizes();
  });
  if (new URLSearchParams(globalThis.location?.search ?? '').get('editGlider') === '1') {
    showEditor();
  }
  cancel?.addEventListener('click', () => {
    invalidateSearch();
    form.hidden = true;
    form.reset();
    closeResults();
    if (status) status.textContent = '';
    if (resetConfirmation instanceof HTMLElement) resetConfirmation.hidden = true;
    if (display instanceof HTMLElement) display.hidden = false;
    edit.focus();
  });
  if (!form.hidden) {
    if (display instanceof HTMLElement) display.hidden = true;
    void hydrateCurrentSizes();
  }

  modelInput.addEventListener('input', () => {
    if (gliderModelId instanceof HTMLInputElement) gliderModelId.value = '';
    if (manufacturer instanceof HTMLInputElement) manufacturer.value = '';
    if (modelValue instanceof HTMLInputElement) modelValue.value = '';
    if (size instanceof HTMLSelectElement) {
      size.replaceChildren(new Option('Select size', ''));
      size.disabled = true;
    }
    if (rating) rating.textContent = 'Select a size';
    invalidateSearch();
    const query = modelInput.value.trim();
    if (!query) {
      closeResults();
      if (status) status.textContent = '';
      return;
    }
    const sequence = searchSequence;
    timer = window.setTimeout(async () => {
      try {
        const items = await fetchMatches(query);
        if (sequence !== searchSequence || !(results instanceof HTMLElement)) return;
        results.replaceChildren();
        for (const [index, item] of items.entries()) {
          const option = documentRef.createElement('button');
          option.type = 'button';
          option.id = `glider-result-${index}`;
          option.setAttribute('role', 'option');
          option.textContent = `${item.manufacturer} ${item.model}`;
          option.addEventListener('click', () => {
            modelInput.value = `${item.manufacturer} ${item.model}`;
            if (manufacturer instanceof HTMLInputElement) manufacturer.value = item.manufacturer;
            if (modelValue instanceof HTMLInputElement) modelValue.value = item.model;
            populateSizes(item.sizes);
            closeResults();
            size?.focus();
          });
          results.append(option);
        }
        results.hidden = items.length === 0;
        modelInput.setAttribute('aria-expanded', String(items.length > 0));
        if (status) status.textContent = items.length ? `${items.length} glider models found.` : 'No matching gliders found.';
      } catch {
        if (sequence !== searchSequence) return;
        closeResults();
        if (status) status.textContent = 'Glider search is temporarily unavailable.';
      }
    }, 120);
  });
  modelInput.addEventListener('keydown', (event) => {
    if (!(results instanceof HTMLElement) || results.hidden) return;
    const options = [...results.querySelectorAll('[role="option"]')];
    if (!options.length) return;
    const active = documentRef.activeElement;
    const activeIndex = options.indexOf(active);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown'
        ? (activeIndex + 1) % options.length
        : (activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
      options[nextIndex]?.focus();
      modelInput.setAttribute('aria-activedescendant', options[nextIndex]?.id ?? '');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeResults();
    }
  });
  results?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeResults();
      modelInput.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const options = [...results.querySelectorAll('[role="option"]')];
      const activeIndex = options.indexOf(documentRef.activeElement);
      if (activeIndex < 0) return;
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown'
        ? (activeIndex + 1) % options.length
        : (activeIndex === 0 ? options.length - 1 : activeIndex - 1);
      options[nextIndex]?.focus();
      modelInput.setAttribute('aria-activedescendant', options[nextIndex]?.id ?? '');
    }
  });
  size?.addEventListener('change', () => {
    if (size instanceof HTMLSelectElement) {
      const selected = size.selectedOptions[0];
      if (gliderModelId instanceof HTMLInputElement) gliderModelId.value = selected?.dataset.modelId || '';
      if (rating) rating.textContent = selected?.dataset.rating || 'Select a size';
    }
  });
  form.addEventListener('submit', (event) => {
    const detailsChanged = (
      (gliderModelId instanceof HTMLInputElement ? gliderModelId.value : '') !== form.dataset.initialModelId
      || (form.elements.namedItem('year')?.value ?? '') !== form.dataset.initialYear
      || (form.elements.namedItem('competitionId')?.value.trim() ?? '') !== form.dataset.initialCompetitionId
    );
    if (!detailsChanged) {
      if (resetConfirmation instanceof HTMLElement) resetConfirmation.hidden = true;
      for (const radio of resetRadios) {
        radio.checked = false;
        radio.required = false;
      }
      return;
    }
    const selectedReset = resetRadios.some((radio) => radio.checked);
    if (!selectedReset) {
      event.preventDefault();
      if (resetConfirmation instanceof HTMLElement) resetConfirmation.hidden = false;
      for (const radio of resetRadios) radio.required = true;
      resetRadios[0]?.focus();
    }
  });
}

if (typeof document !== 'undefined') initializeProfileLists(document);
if (typeof document !== 'undefined' && globalThis.location?.hash === '#new-group') {
  const createGroup = document.querySelector('#new-group');
  if (createGroup instanceof HTMLDetailsElement) createGroup.open = true;
}
