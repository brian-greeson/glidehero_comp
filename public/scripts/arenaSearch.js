function arenaResultLabel(arena) {
  const region = [arena.city, arena.state, arena.country].filter(Boolean).join(', ');
  return region ? `${arena.name} — ${region}` : arena.name;
}

export function initializeArenaSearch({
  documentRef = document,
  fetchImpl = window.fetch.bind(window),
  navigate = (path) => window.location.assign(path),
  debounceMs = 200,
} = {}) {
  const root = documentRef.querySelector('[data-arena-search]');
  const input = documentRef.querySelector('[data-arena-search-input]');
  const results = documentRef.querySelector('[data-arena-search-results]');
  if (!root || !input || !results) return;

  let timer;
  let controller;
  let requestSequence = 0;
  let arenas = [];
  let activeIndex = -1;

  function cancelPendingSearch() {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    requestSequence += 1;
  }

  function hideResults() {
    arenas = [];
    activeIndex = -1;
    results.replaceChildren();
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function close() {
    cancelPendingSearch();
    hideResults();
  }

  function setActive(index) {
    const options = [...results.querySelectorAll('[role="option"]')];
    if (options.length === 0) return;
    activeIndex = ((index % options.length) + options.length) % options.length;
    options.forEach((option, optionIndex) => option.setAttribute('aria-selected', String(optionIndex === activeIndex)));
    const active = options[activeIndex];
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView?.({ block: 'nearest' });
  }

  function render(nextArenas, status = '') {
    arenas = nextArenas;
    activeIndex = -1;
    results.replaceChildren();
    if (status) {
      const message = documentRef.createElement('p');
      message.className = 'arena-search-status';
      message.textContent = status;
      results.append(message);
    } else {
      nextArenas.forEach((arena, index) => {
        const option = documentRef.createElement('button');
        option.type = 'button';
        option.id = `arena-search-option-${index}`;
        option.className = 'arena-search-option';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.textContent = arenaResultLabel(arena);
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => navigate(arena.path));
        results.append(option);
      });
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function search(query) {
    timer = undefined;
    controller?.abort();
    controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const sequence = ++requestSequence;
    render([], 'Searching Arenas…');
    try {
      const response = await fetchImpl(`/v1/arenas?q=${encodeURIComponent(query)}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: controller?.signal,
      });
      if (!response.ok) throw new Error(`Arena search failed with ${response.status}.`);
      const payload = await response.json();
      if (sequence !== requestSequence) return;
      render(payload.arenas, payload.arenas.length === 0 ? 'No Arenas found.' : '');
    } catch (error) {
      if (error?.name !== 'AbortError' && sequence === requestSequence) render([], 'Unable to search Arenas.');
    }
  }

  input.addEventListener('input', () => {
    cancelPendingSearch();
    const query = input.value.trim();
    if (!query) {
      hideResults();
      return;
    }
    timer = setTimeout(() => void search(query), debounceMs);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (arenas.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex < 0 ? arenas.length - 1 : activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      navigate(arenas[activeIndex].path);
    }
  });

  input.addEventListener('focus', () => {
    if (results.childNodes.length > 0) {
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
  });
  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget)) close();
  });
}
