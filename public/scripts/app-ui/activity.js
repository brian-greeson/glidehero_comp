/** Progressive enhancement for the refreshed Activity page. */
export function initializeActivityUi(documentRef = document, fetchImpl = fetch) {
  const feed = documentRef.querySelector('[data-activity-feed]');
  if (!feed) return;

  const likeSubmit = async (event) => {
    const form = event.target?.closest?.('[data-like-form]');
    if (!form || form.dataset.likePending === 'true') return;
    event.preventDefault();
    const button = form.querySelector('[data-like-button]');
    const label = form.querySelector('[data-like-label]');
    const count = form.querySelector('[data-like-count]');
    const status = form.querySelector('[data-like-status]');
    if (!button || !label || !count) return;
    const previous = { pressed: button.getAttribute('aria-pressed'), label: label.textContent, count: count.textContent };
    form.dataset.likePending = 'true';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const response = await fetchImpl(form.action, { method: 'POST', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Like request failed.');
      const result = await response.json();
      if (typeof result?.reacted !== 'boolean' || !Number.isFinite(Number(result.totalCount))) throw new Error('Like response was invalid.');
      button.setAttribute('aria-pressed', result.reacted ? 'true' : 'false');
      label.textContent = result.reacted ? 'Like sent' : 'Send a Like';
      button.setAttribute('aria-label', label.textContent);
      count.textContent = String(Math.max(0, Number(result.totalCount)));
      if (status) status.textContent = result.reacted ? 'Like sent.' : 'Like removed.';
    } catch {
      if (previous.pressed === null) button.removeAttribute('aria-pressed'); else button.setAttribute('aria-pressed', previous.pressed);
      label.textContent = previous.label;
      count.textContent = previous.count;
      if (status) { status.setAttribute('role', 'alert'); status.textContent = 'Could not update Like. Please try again.'; }
    } finally {
      delete form.dataset.likePending;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  };
  feed.addEventListener('submit', likeSubmit);

  let loading = false;
  const loadMore = async (event) => {
    const link = event.target?.closest?.('[data-activity-load-more]');
    if (!link || loading) return;
    event.preventDefault();
    loading = true;
    link.setAttribute('aria-busy', 'true');
    const status = feed.querySelector('[data-activity-load-more-status]');
    if (status) status.textContent = 'Loading more activity…';
    try {
      const response = await fetchImpl(link.dataset.fragmentHref || link.href, { headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error('Activity request failed.');
      const html = await response.text();
      const fragment = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-activity-feed]');
      if (!fragment) throw new Error('Activity response was invalid.');
      for (const card of fragment.querySelectorAll('[data-activity-kind]')) feed.insertBefore(documentRef.importNode(card, true), link);
      const nextLink = fragment.querySelector('[data-activity-load-more]');
      if (nextLink) link.replaceWith(documentRef.importNode(nextLink, true)); else link.remove();
      if (status) status.textContent = '';
    } catch {
      link.removeAttribute('aria-busy');
      if (status) { status.setAttribute('role', 'alert'); status.textContent = 'Could not load more activity. Please try again.'; }
    } finally { loading = false; }
  };
  feed.addEventListener('click', loadMore);
}

if (typeof document !== 'undefined') initializeActivityUi();
