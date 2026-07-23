/**
 * Earned-achievement disclosure. The server renders every card for no-JS
 * visitors; initialization hides achievements beyond the latest per category.
 */
export function initializeAchievementLists(documentRef = document) {
  for (const toggle of documentRef.querySelectorAll('[data-achievement-list-toggle]')) {
    const listName = toggle.dataset.achievementListToggle;
    const list = listName ? documentRef.querySelector(`[data-achievement-list="${listName}"]`) : null;
    if (!list) continue;
    const extras = [...list.querySelectorAll('[data-achievement-list-item="extra"]')];
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

if (typeof document !== 'undefined') initializeAchievementLists(document);
