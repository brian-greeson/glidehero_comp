/** Progressive enhancement for the Activity feed's server-rendered pager. */
export function initializeActivityFeed(documentRef = document, fetchImpl = fetch) {
  const container = documentRef.querySelector('[data-activity-feed-container]');
  if (!container) return;

  const loadMore = () => container.querySelector('[data-activity-load-more]');
  let loading = false;

  const thermalFormFromEvent = (event) => {
    const target = event.target;
    if (target?.closest) return target.closest('[data-thermal-form]');
    return target?.dataset?.thermalForm !== undefined ? target : null;
  };

  const thermalSubmit = async (event) => {
    const form = thermalFormFromEvent(event);
    if (!form) return;
    event.preventDefault();
    if (form.dataset.thermalPending === 'true') return;
    const button = form.querySelector?.('[data-thermal-button]');
    const label = form.querySelector?.('[data-thermal-label]');
    const count = form.querySelector?.('[data-thermal-count]');
    const status = form.querySelector?.('[data-thermal-status]');
    if (!button || !label || !count) return;

    const previous = {
      pressed: button.getAttribute('aria-pressed'),
      ariaLabel: button.getAttribute('aria-label'),
      label: label.textContent,
      count: count.textContent,
    };
    form.dataset.thermalPending = 'true';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (status) {
      status.removeAttribute('role');
      status.textContent = '';
    }
    try {
      const response = await fetchImpl(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Thermal request failed (${response.status}).`);
      const result = await response.json();
      if (typeof result?.reacted !== 'boolean' || !Number.isFinite(Number(result.totalCount))) {
        throw new Error('Thermal response was invalid.');
      }
      const reacted = result.reacted;
      button.setAttribute('aria-pressed', reacted ? 'true' : 'false');
      const nextLabel = reacted ? 'Thermal sent' : 'Send a Thermal';
      label.textContent = nextLabel;
      button.setAttribute('aria-label', nextLabel);
      count.textContent = String(Math.max(0, Number(result.totalCount)));
      if (status) status.textContent = reacted ? 'Thermal sent.' : 'Thermal removed.';
    } catch (error) {
      if (previous.pressed === null) button.removeAttribute('aria-pressed');
      else button.setAttribute('aria-pressed', previous.pressed);
      label.textContent = previous.label;
      if (previous.ariaLabel === null) button.removeAttribute('aria-label');
      else button.setAttribute('aria-label', previous.ariaLabel);
      count.textContent = previous.count;
      if (status) {
        status.setAttribute('role', 'alert');
        status.textContent = 'Could not update Thermal. Please try again.';
      }
    } finally {
      delete form.dataset.thermalPending;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  };

  const fetchNext = async (event) => {
    const link = event.currentTarget;
    if (loading || !link || link.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    loading = true;
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('aria-busy', 'true');
    const status = container.querySelector('[data-activity-load-more-status]');
    if (status) status.textContent = 'Loading more activity…';
    try {
      const endpoint = link.dataset.fragmentHref || link.href;
      const response = await fetchImpl(endpoint, { headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error(`Activity request failed (${response.status}).`);
      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const fragment = parsed.querySelector('[data-activity-feed-container]');
      if (!fragment) throw new Error('Activity response was invalid.');
      const incomingCards = fragment.querySelector('[data-activity-feed-list]')?.children;
      let list = container.querySelector('[data-activity-feed-list]');
      if (incomingCards?.length) {
        if (!list) {
          list = documentRef.createElement('div');
          list.className = 'activity-feed-list';
          list.setAttribute('data-activity-feed-list', '');
          container.querySelector('[data-activity-empty]')?.remove();
          container.insertBefore(list, loadMore() ?? null);
        }
        list.append(...Array.from(incomingCards, (card) => documentRef.importNode(card, true)));
      }
      const nextLink = fragment.querySelector('[data-activity-load-more]');
      const currentLink = loadMore();
      if (currentLink) {
        if (nextLink) currentLink.replaceWith(documentRef.importNode(nextLink, true));
        else currentLink.remove();
      }
      const nextStatus = container.querySelector('[data-activity-load-more-status]');
      if (nextStatus) nextStatus.textContent = '';
      bind();
    } catch (error) {
      link.removeAttribute('aria-disabled');
      link.removeAttribute('aria-busy');
      const status = container.querySelector('[data-activity-load-more-status]');
      if (status) {
        status.setAttribute('role', 'alert');
        status.textContent = 'Could not load more activity. Please try again.';
      }
    } finally {
      loading = false;
    }
  };

  const bind = () => loadMore()?.addEventListener('click', fetchNext);
  container.addEventListener('submit', thermalSubmit);
  bind();
}

if (typeof document !== 'undefined') initializeActivityFeed();
