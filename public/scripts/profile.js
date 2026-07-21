export function initializeProfileLists(documentRef = document) {
  const toggles = documentRef.querySelectorAll('[data-profile-list-toggle]');

  for (const toggle of toggles) {
    const listId = toggle.getAttribute('aria-controls');
    const list = listId ? documentRef.getElementById(listId) : null;
    if (!list) continue;

    const showAllLabel = toggle.dataset.showAllLabel ?? 'Show all';
    const showFewerLabel = toggle.dataset.showFewerLabel ?? 'Show fewer';
    list.setAttribute('data-collapsible', '');
    toggle.hidden = false;

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? showFewerLabel : showAllLabel;
      if (expanded) list.setAttribute('data-expanded', '');
      else list.removeAttribute('data-expanded');
    });
  }
}

if (typeof document !== 'undefined') initializeProfileLists();
