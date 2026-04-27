// Generate the GhostFrog app icon — a ghost-frog hybrid rendered from SVG.
//
// Design:
//   - Rounded-square dark gradient background (modern app-icon look)
//   - Classic ghost silhouette body (wavy bottom) with subtle green tint
//   - Two big bulging frog-style eyes that sit ON TOP of the head
//   - Wide curved frog mouth
//   - Soft glow + shadow for depth
//
// Renders SVG → 1024px PNG via @resvg/resvg-js, then bundles a multi-resolution ICO.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import pngToIco from 'png-to-ico';

const SIZE = 1024;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%">
      <stop offset="0%" stop-color="#3a2a6e"/>
      <stop offset="60%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#0d0d1a"/>
    </radialGradient>
    <linearGradient id="ghost" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#f4fff5"/>
      <stop offset="55%" stop-color="#dff5e3"/>
      <stop offset="100%" stop-color="#b8e8c4"/>
    </linearGradient>
    <radialGradient id="eyeShine" cx="35%" cy="30%" r="70%">
      <stop offset="0%"  stop-color="#ffffff"/>
      <stop offset="80%" stop-color="#e8f8ec"/>
      <stop offset="100%" stop-color="#9bd6ad"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%"  stop-color="#7aff9c" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#7aff9c" stop-opacity="0"/>
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dx="0" dy="10" result="off"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect x="0" y="0" width="1024" height="1024" rx="200" ry="200" fill="url(#bg)"/>
  <ellipse cx="512" cy="640" rx="360" ry="300" fill="url(#glow)"/>

  <g filter="url(#softShadow)">
    <!-- Ghost body — dome top + wavy bottom hem -->
    <path d="
      M 232 540
      C 232 385, 392 240, 512 240
      C 632 240, 792 385, 792 540
      L 792 820
      C 792 820, 750 870, 722 820
      C 694 770, 652 770, 624 820
      C 596 870, 554 870, 526 820
      C 498 770, 456 770, 428 820
      C 400 870, 358 870, 330 820
      C 302 770, 260 770, 232 820
      Z
    " fill="url(#ghost)"/>
    <!-- Frog eye sockets sitting ON TOP of the head -->
    <circle cx="392" cy="260" r="118" fill="url(#ghost)"/>
    <circle cx="632" cy="260" r="118" fill="url(#ghost)"/>
  </g>

  <!-- Eye whites -->
  <circle cx="392" cy="262" r="92" fill="url(#eyeShine)"/>
  <circle cx="632" cy="262" r="92" fill="url(#eyeShine)"/>

  <!-- Vertical frog-slit pupils -->
  <ellipse cx="378" cy="270" rx="18" ry="52" fill="#0d0d1a"/>
  <ellipse cx="646" cy="270" rx="18" ry="52" fill="#0d0d1a"/>

  <!-- Catch-light highlights -->
  <ellipse cx="368" cy="232" rx="14" ry="20" fill="#ffffff" opacity="0.95"/>
  <ellipse cx="636" cy="232" rx="14" ry="20" fill="#ffffff" opacity="0.95"/>

  <!-- Wide curved frog mouth -->
  <path d="M 380 540 Q 512 660 644 540"
        stroke="#1a1a2e" stroke-width="14" stroke-linecap="round" fill="none"/>
  <!-- Tiny tongue hint -->
  <path d="M 488 590 Q 512 612 536 590"
        stroke="#ff7aa8" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.85"/>

  <!-- Cheek blush -->
  <ellipse cx="320" cy="540" rx="38" ry="20" fill="#ff9ec4" opacity="0.35"/>
  <ellipse cx="704" cy="540" rx="38" ry="20" fill="#ff9ec4" opacity="0.35"/>
</svg>`;

function renderPng(size) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return r.render().asPng();
}

const png = renderPng(SIZE);
writeFileSync('resources/icon.png', png);
console.log(`icon.png created: ${png.length} bytes (${SIZE}x${SIZE})`);

// Multi-resolution ICO so Windows picks a crisp size for each UI scale.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoBuffers = icoSizes.map(renderPng);
const icoBuf = await pngToIco(icoBuffers);
writeFileSync('resources/icon.ico', icoBuf);
console.log(`icon.ico created: ${icoBuf.length} bytes (sizes: ${icoSizes.join(', ')})`);
