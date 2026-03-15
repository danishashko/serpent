// Generate a GhostFrog app icon (256x256 PNG + ICO conversion)
import { Jimp } from 'jimp';
import { writeFileSync } from 'fs';

const SIZE = 256;

async function main() {
  const img = new Jimp({ width: SIZE, height: SIZE, color: 0x1a1a2eff });

  // Draw a simple frog silhouette - green circle body with eyes
  const cx = SIZE / 2, cy = SIZE / 2, r = 100;

  // Body (green circle)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Main body
      if (dist < r) {
        img.setPixelColor(0x2ecc71ff, x, y);
      }

      // Left eye (white)
      const lex = cx - 35, ley = cy - 40, er = 22;
      const edl = Math.sqrt((x - lex) ** 2 + (y - ley) ** 2);
      if (edl < er) {
        img.setPixelColor(0xffffffff, x, y);
        // Pupil
        if (edl < 10) img.setPixelColor(0x1a1a2eff, x, y);
      }

      // Right eye (white)
      const rex = cx + 35, rey = cy - 40;
      const edr = Math.sqrt((x - rex) ** 2 + (y - rey) ** 2);
      if (edr < er) {
        img.setPixelColor(0xffffffff, x, y);
        if (edr < 10) img.setPixelColor(0x1a1a2eff, x, y);
      }

      // Mouth (wide smile)
      if (dy > 10 && dy < 50 && Math.abs(dx) < 55) {
        const mouthCurve = 10 + (dx * dx) / 80;
        if (Math.abs(dy - mouthCurve - 15) < 4) {
          img.setPixelColor(0x1a1a2eff, x, y);
        }
      }
    }
  }

  // Add "GF" text-like marking at bottom
  const buf = await img.getBuffer('image/png');
  writeFileSync('resources/icon.png', buf);
  console.log(`icon.png created: ${buf.length} bytes`);

  // Convert to ICO using default export (accepts file paths)
  const { default: pngToIco } = await import('png-to-ico');
  const icoBuf = await pngToIco('resources/icon.png');
  writeFileSync('resources/icon.ico', icoBuf);
  console.log(`icon.ico created: ${icoBuf.length} bytes`);
}

main().catch(console.error);
