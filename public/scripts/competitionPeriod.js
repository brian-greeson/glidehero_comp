export const ALL_TIME_COMPETITION_PERIOD = 'all-time';
export const CURRENT_MONTH_COMPETITION_PERIOD = 'current-month';

export function formatBrowserLocalMonth(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function competitionMonthFromSearch(search = '') {
  const month = new URLSearchParams(search).get('month');
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return month;
}

export function mapPeriodFromSearch(search = '', date = new Date()) {
  const query = new URLSearchParams(search);
  const month = competitionMonthFromSearch(search);
  if (month) return { period: CURRENT_MONTH_COMPETITION_PERIOD, month };
  if (query.get('period') === ALL_TIME_COMPETITION_PERIOD && !query.has('month')) {
    return { period: ALL_TIME_COMPETITION_PERIOD, month: null };
  }
  return {
    period: CURRENT_MONTH_COMPETITION_PERIOD,
    month: formatBrowserLocalMonth(date),
  };
}

export function formatCompetitionMonthLabel(month, locale) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    .format(new Date(year, monthNumber - 1, 1));
}

export function shiftCompetitionMonth(month, offset) {
  const [year, monthNumber] = month.split('-').map(Number);
  return formatBrowserLocalMonth(new Date(year, monthNumber - 1 + offset, 1));
}

export function competitionPageUrl(path, month, search = '') {
  const url = new URL(path, 'http://glidehero.local');
  const query = new URLSearchParams(search);
  query.delete('month');
  query.delete('period');
  if (month) query.set('month', month);
  else query.set('period', ALL_TIME_COMPETITION_PERIOD);
  url.search = query.toString();
  return `${url.pathname}${url.search}`;
}

export function initializeCompetitionPeriodControl({
  documentRef = document,
  locationRef = typeof window === 'undefined' ? { pathname: '', search: '' } : window.location,
  historyRef = typeof window === 'undefined' ? undefined : window.history,
  now = () => new Date(),
  onChange = () => undefined,
} = {}) {
  const buttons = Array.from(documentRef.querySelectorAll?.('[data-competition-period-option]') ?? []);
  const currentMonthOptions = Array.from(documentRef.querySelectorAll?.('[data-current-month-option]') ?? []);
  if (!currentMonthOptions.length) {
    const option = documentRef.querySelector?.('[data-current-month-option]');
    if (option) currentMonthOptions.push(option);
  }
  const periodLinks = [
    ...Array.from(documentRef.querySelectorAll?.('[data-competition-period-link]') ?? []),
    ...Array.from(documentRef.querySelectorAll?.('[data-map-period-link]') ?? []),
  ];
  const returnToInputs = Array.from(documentRef.querySelectorAll?.('[data-competition-return-to]') ?? []);
  const monthNavigation = Array.from(documentRef.querySelectorAll?.('[data-competition-month-nav]') ?? []);
  const initial = mapPeriodFromSearch(locationRef.search, now());
  let month = initial.month;
  let period = initial.period;

  function pageUrl() {
    const query = new URLSearchParams(locationRef.search);
    query.delete('month');
    query.delete('period');
    if (month) query.set('month', month);
    else query.set('period', ALL_TIME_COMPETITION_PERIOD);
    const search = query.toString();
    return `${locationRef.pathname}${search ? `?${search}` : ''}`;
  }

  function render() {
    for (const button of buttons) {
      const selected = button.dataset.competitionPeriodOption === period;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const option of currentMonthOptions)
      option.textContent = month ? formatCompetitionMonthLabel(month) : 'Current Month';
    const browserMonth = formatBrowserLocalMonth(now());
    for (const button of monthNavigation) {
      const enabled = period === CURRENT_MONTH_COMPETITION_PERIOD;
      const isNext = button.dataset.competitionMonthNav === 'next';
      button.disabled = !enabled || (isNext && month >= browserMonth);
      button.hidden = period === ALL_TIME_COMPETITION_PERIOD;
      button.setAttribute?.('aria-disabled', String(button.disabled));
    }
    for (const link of periodLinks) {
      const isMapPeriodLink = !link.dataset.competitionPeriodLink;
      const linkPath = isMapPeriodLink ? locationRef.pathname : link.dataset.competitionPeriodLink;
      const linkMonth = isMapPeriodLink && link.dataset.mapPeriodLink === ALL_TIME_COMPETITION_PERIOD
        ? null
        : (month ?? formatBrowserLocalMonth(now()));
      link.href = competitionPageUrl(linkPath, linkMonth, locationRef.search);
    }
    for (const input of returnToInputs) input.value = pageUrl();
  }

  function replaceUrl() {
    historyRef?.replaceState(null, '', pageUrl());
  }

  for (const button of buttons) {
    button.addEventListener('click', async () => {
      const nextPeriod = button.dataset.competitionPeriodOption;
      if (nextPeriod === period || ![
        ALL_TIME_COMPETITION_PERIOD,
        CURRENT_MONTH_COMPETITION_PERIOD,
      ].includes(nextPeriod)) return;
      period = nextPeriod;
      month = period === CURRENT_MONTH_COMPETITION_PERIOD ? formatBrowserLocalMonth(now()) : null;
      replaceUrl();
      render();
      await onChange({ period, month });
    });
  }

  for (const button of monthNavigation) {
    button.addEventListener('click', async () => {
      if (button.disabled || period !== CURRENT_MONTH_COMPETITION_PERIOD || !month) return;
      const offset = button.dataset.competitionMonthNav === 'previous' ? -1 : 1;
      const nextMonth = shiftCompetitionMonth(month, offset);
      if (nextMonth > formatBrowserLocalMonth(now())) return;
      month = nextMonth;
      replaceUrl();
      render();
      await onChange({ period, month });
    });
  }

  for (const link of periodLinks) {
    link.addEventListener?.('click', async (event) => {
      event?.preventDefault?.();
      const nextPeriod = link.dataset.competitionPeriodLink ?? link.dataset.mapPeriodLink;
      if (![ALL_TIME_COMPETITION_PERIOD, CURRENT_MONTH_COMPETITION_PERIOD].includes(nextPeriod)) return;
      period = nextPeriod;
      month = period === CURRENT_MONTH_COMPETITION_PERIOD ? formatBrowserLocalMonth(now()) : null;
      replaceUrl();
      render();
      await onChange({ period, month });
    });
  }

  const canonicalUrl = pageUrl();
  const currentUrl = `${locationRef.pathname}${locationRef.search}`;
  if (canonicalUrl !== currentUrl) replaceUrl();
  render();
  return {
    get month() { return month; },
    get period() { return period; },
  };
}
