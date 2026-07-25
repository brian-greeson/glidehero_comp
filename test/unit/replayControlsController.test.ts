import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser asset remains JavaScript.
import { initializeReplayControls } from '../../public/scripts/replayControlsController.js';

function node(value = '60') {
  const listeners = new Map<string, Function>();
  return {
    hidden: false, disabled: false, value, max: '', textContent: '',
    addEventListener: (type: string, listener: Function) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    click: function click(this: any) { listeners.get('click')?.({ currentTarget: this }); },
    change: function change(this: any) { listeners.get('change')?.({ currentTarget: this }); },
    setAttribute: vi.fn(),
  } as any;
}

describe('shared replay controls', () => {
  it('syncs every speed select from timeline state and resets on reopen', async () => {
    const open = node(); const panel = node(); const status = node(); const play = node();
    const close = node(); const slider = node(); const elapsed = node();
    const speeds = [node(), node()]; const syncs = [node(), node()];
    const bySelector: Record<string, any[]> = {
      '[data-map-replay-open]': [open], '[data-map-replay-panel]': [panel], '[data-map-replay-status]': [status],
      '[data-map-replay-play]': [play], '[data-map-replay-play-label]': [], '[data-map-replay-play-icon]': [],
      '[data-map-replay-close]': [close], '[data-map-replay-slider]': [slider], '[data-map-replay-elapsed]': [elapsed],
      '[data-map-replay-speed]': speeds, '[data-map-replay-sync]': syncs,
    };
    const documentRef = { querySelector: () => null, querySelectorAll: (selector: string) => bySelector[selector] ?? [] } as any;
    const timelines: any[] = [];
    const controller: any = initializeReplayControls({ documentRef, onOpen: ({ setTimeline }: any) => {
      const timeline: any = {
        synchronized: false,
        subscribe: (cb: any) => { timeline.cb = cb; cb({ elapsedMs: 0, duration: 1000, rate: 60, playing: false, synchronized: timeline.synchronized }); },
        snapshot: () => ({ playing: false, synchronized: timeline.synchronized }),
        setRate: vi.fn(),
        setSynchronized: vi.fn((value) => { timeline.synchronized = value; timeline.cb({ elapsedMs: 0, duration: 2000, rate: 60, playing: false, synchronized: value }); }),
        destroy: vi.fn(),
      };
      timelines.push(timeline); setTimeline(timeline);
    } });
    open.click();
    expect(timelines).toHaveLength(1);
    speeds[1].value = '200'; speeds[1].change();
    timelines[0].cb({ elapsedMs: 0, duration: 1000, rate: 200, playing: false });
    expect(speeds.map((speed) => speed.value)).toEqual(['200', '200']);
    syncs[1].click();
    expect(timelines[0].setSynchronized).toHaveBeenCalledWith(true);
    expect(syncs.every((sync) => sync.setAttribute.mock.calls.some((call: unknown[]) => call[0] === 'aria-pressed' && call[1] === 'true'))).toBe(true);
    close.click(); open.click();
    expect(timelines).toHaveLength(2);
    expect(speeds.map((speed) => speed.value)).toEqual(['60', '60']);
    expect(syncs.every((sync) => sync.setAttribute.mock.calls.some((call: unknown[]) => call[0] === 'aria-pressed' && call[1] === 'false'))).toBe(true);
    controller.destroy();
  });
});
