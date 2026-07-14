import { describe, expect, it } from 'vitest';
import { createPageRenderer } from '../../src/views/renderer.js';

describe('Vento page renderer', () => {
  const render = createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' });

  it('compiles and renders the anonymous page state', async () => {
    const anonymous = await render({ currentUser: null });

    expect(anonymous).toContain('<title>GlideHero</title>');
    expect(anonymous).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
    expect(anonymous).toContain('<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">');
    expect(anonymous).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">');
    expect(anonymous).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">');
    expect(anonymous).toContain('<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">');
    expect(anonymous).toContain('Paint the sky with your friends.');
    expect(anonymous).toContain('class="landing" data-auth-landing data-auth-initial="login"');
    expect(anonymous).toContain('<script type="module" src="/scripts/landing.js"></script>');
    expect(anonymous).toContain('aria-selected="true" tabindex="0">Log in</button>');
    expect(anonymous).toContain('action="/login"');
    expect(anonymous).toContain('action="/signup"');
    expect(anonymous).not.toContain('data-onboarding-trigger');
    expect(anonymous).not.toContain('data-onboarding-dialog');
    expect(anonymous).not.toContain('action="/logout"');
  });

  it('renders the authenticated dashboard scaffold with working account workflows', async () => {
    const authenticated = await render({
      currentUser: {
        userId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        email: 'pilot@example.com',
        displayName: 'Sky Pilot',
        territoryColor: '#1769AA',
      },
    });

    expect(authenticated).toContain('Sky Pilot');
    expect(authenticated).toContain('<img class="brand-logo" src="/android-chrome-192x192.png" alt="">');
    expect(authenticated).toContain('aria-label="Glide Hero dashboard"');
    expect(authenticated).toContain('<span class="brand-name">GLIDE HERO</span>');
    expect(authenticated).not.toContain('class="brand-wing"');
    expect(authenticated).toContain('pilot@example.com');
    expect(authenticated).toContain('action="/logout"');
    expect(authenticated).toContain('action="/profile/territory-color"');
    expect(authenticated).toContain('value="#1769AA"');
    expect(authenticated).toContain('data-dashboard-map');
    expect(authenticated).toContain('data-onboarding-trigger');
    expect(authenticated).toContain('aria-controls="glide-hero-onboarding"');
    expect(authenticated).not.toContain('data-stub="help"');
    expect(authenticated).toContain('<dialog id="glide-hero-onboarding"');
    expect(authenticated).toContain('data-onboarding-dialog');
    expect(authenticated.match(/data-onboarding-step/g)).toHaveLength(3);
    expect([...authenticated.matchAll(/<h2[^>]*data-onboarding-heading[^>]*tabindex="-1"[^>]*>/g)]).toHaveLength(3);
    expect(authenticated).toContain('Welcome to Glide Hero!');
    expect(authenticated).toContain('Claim cells as you fly');
    expect(authenticated).toContain('Close the loop');
    expect(authenticated).toContain('data-onboarding-back');
    expect(authenticated).toContain('data-onboarding-next');
    expect(authenticated).toContain('data-onboarding-done');
    expect(authenticated).toContain('data-onboarding-close');
    expect(authenticated.match(/data-onboarding-progress/g)).toHaveLength(3);
    expect(authenticated).toContain('style="--territory-color: #1769AA"');
    expect(authenticated).toContain('data-mobile-sheet');
    expect(authenticated).toContain('data-account-popover');
    expect(authenticated).toContain('class="mode-tab" data-competitive-mode>Competitive</button>');
    expect(authenticated).not.toContain('data-stub="competitive-mode"');
    expect(authenticated).toContain('class="mode-tab is-active" data-personal-mode aria-current="page">Personal</button>');
    expect(authenticated).toContain('data-territory-color="#1769AA"');
    expect(authenticated).toContain('data-current-user-id="00000000-0000-4000-8000-000000000001"');
    expect(authenticated).toContain('<script type="module" src="/scripts/dashboard.js"></script>');
    expect(authenticated).toContain('data-stub="full-leaderboard"');
    expect(authenticated).toContain('No territory data is available for this viewport yet.');
    expect(authenticated).toContain('https://api.maptiler.com/maps/outdoor-v2/style.json?key=maptiler-test-key');
    expect(authenticated).not.toContain('action="/login"');
    expect(authenticated).not.toContain('action="/signup"');
  });

  it('autoescapes user-controlled values and never renders passwords', async () => {
    const html = await render({
      currentUser: null,
      signupError: 'An account with that email already exists.',
      signupEmail: '<pilot@example.com>',
      signupDisplayName: '<script>alert(1)</script>',
    });

    expect(html).toContain('An account with that email already exists.');
    expect(html).toContain('data-auth-initial="signup"');
    expect(html).toContain('aria-selected="true" tabindex="0">Create account</button>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('value="never-render-this-password"');
  });
});
