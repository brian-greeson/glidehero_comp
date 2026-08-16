import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser asset is JavaScript.
import { createMapReplayCamera, isMapReplayCameraMoveEvent, MAP_REPLAY_FOLLOW_LABEL, MAP_REPLAY_FOLLOW_ZOOM, MAP_REPLAY_RESUME_LABEL } from '../../public/scripts/mapReplayCamera.js';

function controlElement() {
  const listeners = new Map<string, Function>();
  const attributes = new Map<string, string>();
  return {
    className: '', type: '', textContent: '', title: '', child: null as any,
    append(child: any) { this.child = child; },
    remove: vi.fn(),
    addEventListener(name: string, listener: Function) { listeners.set(name, listener); },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    getAttribute(name: string) { return attributes.get(name); },
    click() { listeners.get('click')?.(); },
  };
}

describe('map replay camera', () => {
  it('zooms to the first active pilot and follows it as it moves', () => {
    const map = { easeTo: vi.fn() };
    const camera = createMapReplayCamera(map);

    camera.update({ flights: [{ flightId: 'first', marker: [-105, 39], completed: false }] });
    camera.update({ flights: [{ flightId: 'first', marker: [-104.9, 39.1], completed: false }] });

    expect(map.easeTo).toHaveBeenNthCalledWith(1, {
      center: [-105, 39],
      zoom: MAP_REPLAY_FOLLOW_ZOOM,
      duration: 0,
    }, { glideheroReplayCamera: true });
    expect(map.easeTo).toHaveBeenNthCalledWith(2, {
      center: [-104.9, 39.1],
      duration: 0,
    }, { glideheroReplayCamera: true });
  });

  it('switches to the next moving pilot after the current flight finishes', () => {
    const map = { easeTo: vi.fn() };
    const camera = createMapReplayCamera(map);

    camera.update({ flights: [
      { flightId: 'first', marker: [-105, 39], completed: true },
      { flightId: 'second', marker: [-104, 40], completed: false },
    ] });

    expect(map.easeTo).toHaveBeenCalledWith({
      center: [-104, 40],
      zoom: MAP_REPLAY_FOLLOW_ZOOM,
      duration: 0,
    }, { glideheroReplayCamera: true });
  });

  it('waits for an active pilot marker before moving the camera', () => {
    const map = { easeTo: vi.fn() };
    const camera = createMapReplayCamera(map);

    camera.update({ flights: [{ flightId: 'first', marker: null, completed: false }] });

    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('stays on the last followed pilot when every flight is complete', () => {
    const map = { easeTo: vi.fn() };
    const camera = createMapReplayCamera(map);

    camera.update({ flights: [
      { flightId: 'first', marker: [-105, 39], completed: true },
      { flightId: 'second', marker: [-104, 40], completed: false },
    ] });
    camera.update({ flights: [
      { flightId: 'first', marker: [-105, 39], completed: true },
      { flightId: 'second', marker: [-103.9, 40.1], completed: true },
    ] });

    expect(map.easeTo).toHaveBeenLastCalledWith({ center: [-103.9, 40.1], duration: 0 }, { glideheroReplayCamera: true });
  });

  it('stops following after a user pan and resumes from the map control', () => {
    const handlers = new Map<string, Function>();
    let controlElementRoot: any;
    const map = {
      easeTo: vi.fn(),
      addControl: vi.fn((control: any) => { controlElementRoot = control.onAdd(); }),
      removeControl: vi.fn(),
      on: vi.fn((name: string, listener: Function) => handlers.set(name, listener)),
      off: vi.fn(),
    };
    const documentRef = { createElement: () => controlElement() } as any;
    const camera = createMapReplayCamera(map, { documentRef });

    camera.update({ flights: [{ flightId: 'first', marker: [-105, 39], completed: false }] });
    handlers.get('dragstart')?.();
    camera.update({ flights: [{ flightId: 'first', marker: [-104.9, 39.1], completed: false }] });

    const button = controlElementRoot.child;
    expect(map.easeTo).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-label')).toBe(MAP_REPLAY_RESUME_LABEL);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    button.click();
    expect(map.easeTo).toHaveBeenLastCalledWith({ center: [-104.9, 39.1], duration: 0 }, { glideheroReplayCamera: true });
    expect(button.getAttribute('aria-label')).toBe(MAP_REPLAY_FOLLOW_LABEL);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    camera.destroy();
    expect(map.off).toHaveBeenCalledWith('dragstart', expect.any(Function));
    expect(map.removeControl).toHaveBeenCalledOnce();
  });

  it('identifies replay camera move events without matching user map moves', () => {
    expect(isMapReplayCameraMoveEvent({ glideheroReplayCamera: true })).toBe(true);
    expect(isMapReplayCameraMoveEvent({ originalEvent: {} })).toBe(false);
    expect(isMapReplayCameraMoveEvent(undefined)).toBe(false);
  });
});
