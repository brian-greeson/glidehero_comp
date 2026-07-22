/**
 * Progressive profile lists. The server renders every row for no-JS users;
 * initialization hides only rows explicitly marked as extra.
 */
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
}

if (typeof document !== 'undefined') initializeProfileLists(document);
