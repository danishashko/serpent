// Generate the Serpent app icon — front-facing cobra with spread hood.
//
// Design:
//   - Dark near-black forest-green background
//   - Cobra hood fanning out wide behind the head (classic cobra silhouette)
//   - Oval head centered, golden slit-pupil eyes, nostril pits
//   - Characteristic hood eye-spot markings
//   - Red forked tongue extending downward
//   - Body coil visible at the bottom
//   - Green/teal palette — clean, technical, instantly recognizable
//
// Renders SVG → 1024px PNG via @resvg/resvg-js, then bundles a multi-resolution ICO.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import pngToIco from 'png-to-ico';

const SIZE = 1024;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <!-- Background -->
    <radialGradient id="bg" cx="50%" cy="45%" r="75%">
      <stop offset="0%"  stop-color="#0d1f10"/>
      <stop offset="100%" stop-color="#040808"/>
    </radialGradient>
    <!-- Green ambient glow -->
    <radialGradient id="glow" cx="50%" cy="42%" r="55%">
      <stop offset="0%"  stop-color="#18e066" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#18e066" stop-opacity="0"/>
    </radialGradient>
    <!-- Hood / body scales -->
    <linearGradient id="scaleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"  stop-color="#2ed870"/>
      <stop offset="50%" stop-color="#1a9c4e"/>
      <stop offset="100%" stop-color="#0a5828"/>
    </linearGradient>
    <!-- Belly / lighter underside -->
    <linearGradient id="bellyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#c8ecc0"/>
      <stop offset="100%" stop-color="#7ec888"/>
    </linearGradient>
    <!-- Head (slightly brighter green on top) -->
    <linearGradient id="headGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#2adc72"/>
      <stop offset="100%" stop-color="#108040"/>
    </linearGradient>
    <!-- Eye — amber/gold -->
    <radialGradient id="eyeGrad" cx="35%" cy="35%" r="65%">
      <stop offset="0%"  stop-color="#ffe040"/>
      <stop offset="70%" stop-color="#c88c10"/>
      <stop offset="100%" stop-color="#6a4800"/>
    </radialGradient>
    <!-- Drop shadow (SVG 1.1 compatible) -->
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="18" result="blur"/>
      <feOffset dx="0" dy="14" in="blur" result="off"/>
      <feFlood flood-color="#000000" flood-opacity="0.55" result="clr"/>
      <feComposite in="clr" in2="off" operator="in" result="shd"/>
      <feMerge><feMergeNode in="shd"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- Clip to rounded-square icon shape -->
    <clipPath id="iconClip">
      <rect width="1024" height="1024" rx="200" ry="200"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="1024" height="1024" rx="200" ry="200" fill="url(#bg)"/>
  <!-- Ambient glow -->
  <ellipse cx="512" cy="430" rx="440" ry="380" fill="url(#glow)"/>

  <g clip-path="url(#iconClip)">

    <!-- ── COBRA HOOD (back layer) ─────────────────────────────── -->
    <!-- Wide fan spreading from the neck, arching up and out to both sides -->
    <path d="
      M 512 560
      C 430 560, 270 530, 155 440
      C  80 370,  70 260, 115 185
      C 155 120, 250 110, 330 150
      C 400 185, 455 270, 512 310
      C 569 270, 624 185, 694 150
      C 774 110, 869 120, 909 185
      C 954 260, 944 370, 869 440
      C 754 530, 594 560, 512 560 Z
    " fill="url(#scaleGrad)" filter="url(#shadow)"/>

    <!-- Hood belly — lighter inner zone -->
    <path d="
      M 512 532
      C 448 532, 316 506, 224 432
      C 168 386, 156 298, 194 236
      C 228 180, 302 170, 370 205
      C 426 233, 472 306, 512 338
      C 552 306, 598 233, 654 205
      C 722 170, 796 180, 830 236
      C 868 298, 856 386, 800 432
      C 708 506, 576 532, 512 532 Z
    " fill="url(#bellyGrad)" opacity="0.42"/>

    <!-- Hood eye-spot markings (classic Indian cobra pattern) -->
    <ellipse cx="365" cy="362" rx="54" ry="40" fill="#000" opacity="0.28"/>
    <ellipse cx="659" cy="362" rx="54" ry="40" fill="#000" opacity="0.28"/>
    <ellipse cx="365" cy="362" rx="32" ry="23" fill="url(#bellyGrad)" opacity="0.52"/>
    <ellipse cx="659" cy="362" rx="32" ry="23" fill="url(#bellyGrad)" opacity="0.52"/>

    <!-- ── BODY COIL (below neck, behind head) ──────────────────── -->
    <!-- U-shaped thick stroke forming a coil at the bottom -->
    <path d="
      M 418 628
      C 294 648, 195 716, 200 804
      C 205 872, 322 912, 512 916
      C 702 912, 819 872, 824 804
      C 829 716, 730 648, 606 628
    " stroke="url(#scaleGrad)" stroke-width="96" fill="none" stroke-linecap="round"/>
    <!-- Coil belly stripe -->
    <path d="
      M 452 638
      C 350 656, 270 710, 274 788
      C 278 852, 378 886, 512 890
      C 646 886, 746 852, 750 788
      C 754 710, 674 656, 572 638
    " stroke="url(#bellyGrad)" stroke-width="36" fill="none" stroke-linecap="round" opacity="0.48"/>

    <!-- ── NECK ──────────────────────────────────────────────────── -->
    <ellipse cx="512" cy="566" rx="80" ry="36" fill="url(#scaleGrad)"/>

    <!-- ── HEAD ──────────────────────────────────────────────────── -->
    <ellipse cx="512" cy="452" rx="142" ry="114" fill="url(#headGrad)" filter="url(#shadow)"/>
    <!-- Jaw / belly lighter patch -->
    <ellipse cx="512" cy="508" rx="102" ry="62" fill="url(#bellyGrad)" opacity="0.58"/>

    <!-- ── EYES ──────────────────────────────────────────────────── -->
    <!-- Left eye -->
    <ellipse cx="448" cy="428" rx="44" ry="44" fill="url(#eyeGrad)"/>
    <ellipse cx="448" cy="428" rx="16" ry="38" fill="#060808"/>
    <ellipse cx="437" cy="415" rx="10" ry="14" fill="#ffffff" opacity="0.88"/>
    <!-- Right eye -->
    <ellipse cx="576" cy="428" rx="44" ry="44" fill="url(#eyeGrad)"/>
    <ellipse cx="576" cy="428" rx="16" ry="38" fill="#060808"/>
    <ellipse cx="565" cy="415" rx="10" ry="14" fill="#ffffff" opacity="0.88"/>

    <!-- Nostril heat-pits -->
    <ellipse cx="484" cy="494" rx="11" ry="8" fill="#041008" opacity="0.72"/>
    <ellipse cx="540" cy="494" rx="11" ry="8" fill="#041008" opacity="0.72"/>

    <!-- Mouth line -->
    <path d="M 402 516 Q 512 548 622 516"
          stroke="#082010" stroke-width="6" fill="none" stroke-linecap="round"/>

    <!-- ── TONGUE (rendered last — appears above the coil) ────────── -->
    <line x1="512" y1="548" x2="512" y2="650" stroke="#e0204a" stroke-width="15" stroke-linecap="round"/>
    <line x1="512" y1="650" x2="452" y2="716" stroke="#e0204a" stroke-width="12" stroke-linecap="round"/>
    <line x1="512" y1="650" x2="572" y2="716" stroke="#e0204a" stroke-width="12" stroke-linecap="round"/>

  </g>
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
