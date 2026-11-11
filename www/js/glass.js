const FILTER_ID = "liquid-glass-filter";

/**
 * Static displacement filter.
 * Turbulence is not animated: several live backdrop-filters already sit on
 * the GPU, and a moving feTurbulence on top of them drops frames on an A15.
 * Scale stays at or below 18, the range Safari renders without tearing.
 */
export function injectGlassFilter() {
  if (document.getElementById(FILTER_ID)) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "liquid-glass-filter-root");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.innerHTML = `
    <filter id="${FILTER_ID}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.015" numOctaves="2" seed="5" result="noise"></feTurbulence>
      <feGaussianBlur in="noise" stdDeviation="1.4" result="soft"></feGaussianBlur>
      <feDisplacementMap in="SourceGraphic" in2="soft" scale="16" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
    </filter>
  `;
  document.body.prepend(svg);
}
