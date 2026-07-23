import { describe, expect, it } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeAchievementLists } from '../../public/scripts/app-ui/achievements.js';

function item() {
  return { hidden: false };
}

function toggleNode() {
  let listener: (() => void) | undefined;
  const attributes = new Map([['aria-expanded', 'false']]);
  return {
    hidden: false,
    textContent: 'Show all',
    dataset: { achievementListToggle: 'earned' },
    addEventListener(_name: string, callback: () => void) { listener = callback; },
    getAttribute(name: string) { return attributes.get(name) ?? null; },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    click() { listener?.(); },
  };
}

describe('achievement disclosure', () => {
  it('shows only the latest per category until Show all is activated', () => {
    const extraOne = item();
    const extraTwo = item();
    const toggle = toggleNode();
    const list = { querySelectorAll: () => [extraOne, extraTwo] };
    const documentRef = {
      querySelectorAll: () => [toggle],
      querySelector: () => list,
    };

    initializeAchievementLists(documentRef);

    expect(extraOne.hidden).toBe(true);
    expect(extraTwo.hidden).toBe(true);
    toggle.click();
    expect(extraOne.hidden).toBe(false);
    expect(extraTwo.hidden).toBe(false);
    expect(toggle.textContent).toBe('Show fewer');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(extraOne.hidden).toBe(true);
    expect(toggle.textContent).toBe('Show all');
  });
});
