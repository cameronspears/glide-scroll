# Changelog

## 0.1.0

First release.

- `glideScroll()` smooths mouse-wheel and trackpad scrolling for the whole page, and returns a
  function that turns it off.
- `<GlideScroll />` from `glide-scroll/react` does the same as a component.
- Pauses hover while the page glides under a still mouse, sleeps when the page is still, and
  switches itself off on devices that can't keep it smooth.
