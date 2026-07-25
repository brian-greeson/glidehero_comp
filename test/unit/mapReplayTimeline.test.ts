import { describe, expect, it } from 'vitest';

// @ts-expect-error Browser asset is JavaScript.
import { createMapReplayTimeline } from '../../public/scripts/mapReplayTimeline.js';

describe('map replay timeline', () => {
  it('replays independently-starting tracks and interpolates markers', () => {
    let clock = 0; const callbacks = new Map<number, (time: number) => void>(); let next = 1;
    const timeline = createMapReplayTimeline({
      flights: [
        { flightId: 'a', pilotUserId: 'p', startOffsetMs: 0, durationMs: 1000, points: [[0, 0, 0], [10, 0, 1000]] },
        { flightId: 'b', pilotUserId: 'q', startOffsetMs: 5000, durationMs: 500, points: [[5, 5, 0], [5, 10, 500]] },
      ], now: () => clock, requestAnimationFrame: (cb: (time: number) => void) => { const id = next++; callbacks.set(id, cb); return id; }, cancelAnimationFrame: (id: number) => callbacks.delete(id),
    });
    expect(timeline.snapshot().rate).toBe(60);
    expect(timeline.snapshot().synchronized).toBe(true);
    timeline.setRate(1);
    timeline.play(); clock = 250; callbacks.get(1)?.(clock); 
    expect(timeline.snapshot().flights[0].marker).toEqual([2.5, 0]);
    expect(timeline.snapshot().flights[1].marker).toEqual([5, 7.5]);
    timeline.pause(); timeline.seek(1000); expect(timeline.snapshot().finished).toBe(true);
    timeline.play(); expect(timeline.snapshot().elapsedMs).toBe(0);
  });

  it('handles duplicate and empty tracks deterministically', () => {
    const timeline = createMapReplayTimeline({ flights: [
      { flightId: 'd', pilotUserId: 'p', durationMs: 10, points: [[1, 1, 0], [2, 2, 0], [3, 3, 10]] },
      { flightId: 'e', pilotUserId: 'q', durationMs: 10, points: [] },
    ] });
    timeline.seek(0);
    expect(timeline.snapshot().flights[0].marker).toEqual([2, 2]);
    expect(timeline.snapshot().flights[1].marker).toBeNull();
  });

  it('scales rate, pauses without accumulating time, seeks backward, and cleans up', () => {
    let clock = 0; let callback: ((time: number) => void) | undefined; let cancelled = 0;
    const timeline = createMapReplayTimeline({ flights: [{ flightId: 'a', pilotUserId: 'p', durationMs: 100, points: [[0, 0, 0], [10, 0, 100]] }], now: () => clock, requestAnimationFrame: (cb: (time: number) => void) => { callback = cb; return 1; }, cancelAnimationFrame: () => { cancelled += 1; } });
    timeline.setRate(2); timeline.play(); clock = 10; callback?.(clock); expect(timeline.snapshot().elapsedMs).toBe(20);
    timeline.pause(); clock = 60; timeline.play(); clock = 70; callback?.(clock); expect(timeline.snapshot().elapsedMs).toBe(40);
    timeline.seek(10); expect(timeline.snapshot().flights[0].track).toEqual([[0, 0], [1, 0]]);
    timeline.destroy(); expect(cancelled).toBeGreaterThan(0);
  });

  it('retains completed shorter flights and handles one-point tracks', () => {
    const timeline = createMapReplayTimeline({ flights: [
      { flightId: 'short', pilotUserId: 'p', durationMs: 10, points: [[0, 0, 0], [1, 0, 10]] },
      { flightId: 'one', pilotUserId: 'q', durationMs: 0, points: [[2, 2, 0]] },
      { flightId: 'long', pilotUserId: 'r', durationMs: 20, points: [[3, 3, 0], [4, 3, 20]] },
    ] });
    timeline.seek(15); const state = timeline.snapshot();
    expect(state.flights[0].completed).toBe(true); expect(state.flights[0].track).toEqual([[0, 0], [1, 0]]);
    expect(state.flights[1].completed).toBe(true); expect(state.flights[1].track).toEqual([[2, 2]]);
    expect(state.flights[2].completed).toBe(false);
  });

  it('uses real start offsets when unsynchronized and hides flights before they start', () => {
    const timeline = createMapReplayTimeline({ flights: [
      { flightId: 'first', pilotUserId: 'p', startOffsetMs: 0, durationMs: 100, points: [[0, 0, 0], [1, 0, 100]] },
      { flightId: 'later', pilotUserId: 'q', startOffsetMs: 1000, durationMs: 200, points: [[2, 2, 0], [4, 2, 200]] },
      { flightId: 'single', pilotUserId: 'r', startOffsetMs: 1100, durationMs: 0, points: [[5, 5, 0]] },
    ] });

    timeline.setSynchronized(false);
    expect(timeline.snapshot()).toMatchObject({ synchronized: false, elapsedMs: 0, duration: 1200, playing: false });
    timeline.seek(999);
    expect(timeline.snapshot().flights[1]).toMatchObject({ track: [], marker: null, completed: false });
    timeline.seek(1050);
    expect(timeline.snapshot().flights[1].marker).toEqual([2.5, 2]);
    expect(timeline.snapshot().flights[2]).toMatchObject({ track: [], marker: null, completed: false });
    timeline.seek(1100);
    expect(timeline.snapshot().flights[2]).toMatchObject({ track: [[5, 5]], marker: [5, 5], completed: true });
  });

  it('pauses and resets to the beginning whenever synchronization changes', () => {
    let callback: ((time: number) => void) | undefined;
    let cancelled = 0;
    const timeline = createMapReplayTimeline({
      flights: [
        { flightId: 'a', pilotUserId: 'p', startOffsetMs: 0, durationMs: 100, points: [[0, 0, 0], [1, 0, 100]] },
        { flightId: 'b', pilotUserId: 'q', startOffsetMs: 1000, durationMs: 100, points: [[2, 0, 0], [3, 0, 100]] },
      ],
      now: () => 0,
      requestAnimationFrame: (cb: (time: number) => void) => { callback = cb; return 1; },
      cancelAnimationFrame: () => { cancelled += 1; },
    });

    timeline.play();
    callback?.(1);
    expect(timeline.snapshot().elapsedMs).toBeGreaterThan(0);
    timeline.setSynchronized(false);
    expect(timeline.snapshot()).toMatchObject({ synchronized: false, elapsedMs: 0, duration: 1100, playing: false, finished: false });
    expect(cancelled).toBe(1);
    timeline.seek(500);
    timeline.setSynchronized(true);
    expect(timeline.snapshot()).toMatchObject({ synchronized: true, elapsedMs: 0, duration: 100, playing: false, finished: false });
  });
});
