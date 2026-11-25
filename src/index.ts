export interface GlideScrollOptions {
  /**
   * How quickly the page catches up with the wheel, in milliseconds. Each period closes about two
   * thirds of the gap left, so the default of 120 settles a flick in about half a second. Lower
   * feels snappier, higher feels floatier.
   */
  catchUpMs?: number;
  /**
   * The sessionStorage key that remembers this device couldn't keep the glide smooth, so later
   * pages in the same visit skip it. Pass `false` to never remember.
   */
  storageKey?: string | false;
}

// Closer than this to where it's heading, the glide is done.
const SETTLED_PX = 0.5;
// The mouse moved this far during a glide: someone is pointing at something, so hover returns.
const POINTING_PX = 4;
// A frame slower than this counts as a stutter. It sits clear of 33ms, the normal frame on a
// browser that runs at 30 frames a second (Safari in Low Power Mode).
const STUTTER_MS = 40;
// Frames per sample: a second and a half of gliding on a 60Hz screen, half that on 120Hz.
const SAMPLE_FRAMES = 90;

function readFlag(key: string | false) {
  if (!key) return false;
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeFlag(key: string | false) {
  if (!key) return;
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // Private windows may refuse storage: the next page finds out for itself.
  }
}

/** Wheel distance in pixels, whatever unit the browser reports it in. */
function wheelPixels(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 40;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

/**
 * True when the wheel belongs to something other than the page: a dialog, or a box under the
 * pointer that scrolls on its own (a menu, a popover, a table) and can still move that way, or
 * that keeps its scroll to itself.
 */
function belongsElsewhere(target: EventTarget | null, delta: number) {
  // Something has locked the page in place (an open menu or panel): leave it locked.
  for (const page of [document.documentElement, document.body]) {
    if (/hidden|clip/.test(getComputedStyle(page).overflowY)) return true;
  }
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node === document.body) return false;
    if (node.tagName === 'DIALOG') return true;
    if (node.scrollHeight <= node.clientHeight + 1) continue;
    const style = getComputedStyle(node);
    if (!/auto|scroll|overlay/.test(style.overflowY)) continue;
    if (style.overscrollBehaviorY !== 'auto') return true;
    const canMove =
      delta > 0 ? node.scrollTop + node.clientHeight < node.scrollHeight - 1 : node.scrollTop > 0;
    if (canMove) return true;
  }
  return false;
}

/**
 * Makes the page glide to a soft stop under a mouse wheel or trackpad, instead of moving in
 * steps. Returns a function that turns it off again.
 *
 * Built to keep every frame cheap:
 * - It only runs while the page is gliding, and sleeps the rest of the time.
 * - Its pace is set in time, not frames, so a 120Hz screen gets twice the frames, not twice the
 *   speed.
 * - While the page glides under a mouse held still, hover is paused, as on a phone. Otherwise
 *   every row passing under the pointer would light up and redraw. Moving the mouse brings hover
 *   back at once.
 *
 * Touch, the keyboard and the scrollbar stay the browser's own, and so do sideways swipes, pinch
 * zoom, dialogs and boxes that scroll on their own. A click or key press ends the glide, and if
 * anything else moves the page (a link to a section, the scrollbar), the glide lets go. Visitors
 * who ask for reduced motion get no glide.
 *
 * If the glide stutters twice in a row, it switches itself off for the rest of the visit and the
 * browser scrolls the page again.
 *
 * On the server, or under reduced motion, it does nothing and returns a function that does nothing.
 *
 * @param options How quickly the glide catches up, and where it remembers a slow device.
 * @returns A function that turns the glide off and removes everything it added.
 *
 * @example
 * import { glideScroll } from 'glide-scroll';
 *
 * const stop = glideScroll();
 * // later: stop();
 */
export function glideScroll(options: GlideScrollOptions = {}): () => void {
  const { catchUpMs = 120, storageKey = 'glide-scroll-off' } = options;
  if (typeof window === 'undefined') return () => {};
  if (readFlag(storageKey) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => {};
  }
  const root = document.documentElement;

  // Where the page is now and where it's heading. Both are only meaningful while gliding.
  let current = 0;
  let target = 0;
  // The furthest the page can go, measured once per glide: measuring it on every wheel tick would
  // make the browser lay out the page again each time.
  let max = 0;
  let frame = 0;
  let lastTime = 0;
  let pointerTravel = 0;

  // The stutter check.
  let frames = 0;
  let stutters = 0;
  let badSamples = 0;

  // An invisible sheet over the page while it glides: the pointer rests on it, so nothing
  // underneath lights up as it passes. Showing one element is far cheaper than switching hover off
  // across the whole page, which would restyle every element on it.
  const sheet = document.createElement('div');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.dataset.glideScroll = '';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none';
  document.body.appendChild(sheet);
  const pauseHover = (paused: boolean) => {
    sheet.style.display = paused ? 'block' : 'none';
  };

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pauseHover(false);
  };

  const step = (now: number) => {
    // Something else moved the page (the scrollbar, a jump to a section): let it.
    if (Math.abs(window.scrollY - Math.round(current)) > 1) return stop();

    // A frame's time is when the frame began, which can be just before the wheel tick that
    // started the glide: never step backwards.
    const gap = Math.max(0, now - lastTime);
    lastTime = now;
    current += (target - current) * (1 - Math.exp(-Math.min(gap, 100) / catchUpMs));
    const done = Math.abs(target - current) < SETTLED_PX;
    if (done) current = target;
    window.scrollTo({ top: current, behavior: 'instant' });
    if (done) return stop();

    frames += 1;
    if (gap > STUTTER_MS) stutters += 1;
    if (frames >= SAMPLE_FRAMES) {
      badSamples = stutters > frames / 4 ? badSamples + 1 : 0;
      frames = 0;
      stutters = 0;
      if (badSamples >= 2) {
        writeFlag(storageKey);
        return cleanup();
      }
    }
    frame = requestAnimationFrame(step);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const delta = wheelPixels(event);
    // Mid-glide the page is latched, as the browser's own scroll is: no need to look for boxes.
    if (!frame && belongsElsewhere(event.target, delta)) return;

    if (!frame) {
      const from = window.scrollY;
      const edge = root.scrollHeight - window.innerHeight;
      // Already at the top or bottom: nothing to glide to, so the browser keeps the wheel (and its
      // edge bounce), rather than a glide starting and stopping on every tick.
      if (delta > 0 ? from >= edge - 1 : from <= 0) return;
      current = from;
      target = from;
      max = edge;
      lastTime = performance.now();
      pointerTravel = 0;
      pauseHover(true);
      frame = requestAnimationFrame(step);
    }
    event.preventDefault();
    target = Math.max(0, Math.min(max, target + delta));
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!frame || sheet.style.display === 'none') return;
    pointerTravel += Math.abs(event.movementX) + Math.abs(event.movementY);
    if (pointerTravel > POINTING_PX) pauseHover(false);
  };

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    stop();
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', stop, true);
    window.removeEventListener('keydown', stop, true);
    sheet.remove();
  };

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  // A click or key press ends the glide. Otherwise the glide would carry on over whatever the
  // press does next: opening a page, jumping to a section, or scrolling by keyboard.
  window.addEventListener('pointerdown', stop, true);
  window.addEventListener('keydown', stop, true);
  return cleanup;
}
