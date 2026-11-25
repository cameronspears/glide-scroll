// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { glideScroll } from '../src/index.js';

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as typeof window.matchMedia;
}

function wheel(init: WheelEventInit) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

describe('glideScroll', () => {
  let off = () => {};
  const frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    setReducedMotion(false);
    sessionStorage.clear();
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
    window.scrollTo = vi.fn() as typeof window.scrollTo;
  });

  afterEach(() => {
    off();
    vi.unstubAllGlobals();
  });

  it('takes the wheel and glides the page there over several frames', () => {
    off = glideScroll();
    const event = wheel({ deltaY: 300 });
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-glide-scroll]')?.style.display).toBe('block');

    frames.shift()!(performance.now() + 16);
    const firstStep = vi.mocked(window.scrollTo).mock.calls[0][0] as ScrollToOptions;
    expect(firstStep.top).toBeGreaterThan(0);
    expect(firstStep.top).toBeLessThan(300);
  });

  it('leaves pinch zoom and sideways swipes to the browser', () => {
    off = glideScroll();
    expect(wheel({ deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel({ deltaY: 10, deltaX: 80 }).defaultPrevented).toBe(false);
  });

  it('does nothing under reduced motion, and cleans up after itself', () => {
    setReducedMotion(true);
    glideScroll()();
    expect(document.querySelector('[data-glide-scroll]')).toBeNull();

    setReducedMotion(false);
    const stop = glideScroll();
    expect(document.querySelectorAll('[data-glide-scroll]')).toHaveLength(1);
    stop();
    expect(document.querySelector('[data-glide-scroll]')).toBeNull();
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false);
  });
});
