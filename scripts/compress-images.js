/**
 * Fun on the Road — Image Compression Script
 *
 * - JPEG: re-compresses in-place at quality 78, max 900px on longest side
 * - PNG:  converts to JPEG at quality 80, saves as .jpg, deletes .png,
 *         then patches all .html references from .png → .jpg
 *
 * Run: node scripts/compress-images.js
 */

const sharp  = require('sharp');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');

const DATA_DIR  = path.join(__dirname, '..', 'www', 'assets', 'data');
const WWW_DIR   = path.join(__dirname, '..', 'www');
const MAX_DIM   = 900;   // px — game images are shown at most ~480px wide on phone
const JPEG_Q    = 78;    // quality

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

async function main() {
  const all = walk(DATA_DIR).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  const jpgs = all.filter(f => /\.(jpg|jpeg)$/i.test(f));
  const pngs = all.filter(f => /\.png$/i.test(f));

  let savedBytes = 0;
  let pngRenames = []; // { from: 'Foo.png', to: 'Foo.jpg' }

  console.log(`\nCompressing ${jpgs.length} JPEGs and converting ${pngs.length} PNGs...\n`);

  // ── Re-compress JPEGs ────────────────────────────────────────────
  for (const file of jpgs) {
    const before = fs.statSync(file).size;
    const tmp = file + '.tmp';
    await sharp(file)
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_Q, mozjpeg: true })
      .toFile(tmp);
    const after = fs.statSync(tmp).size;
    if (after < before) {
      fs.renameSync(tmp, file);
      savedBytes += before - after;
      const pct = Math.round((1 - after / before) * 100);
      console.log(`  ✓  ${path.relative(DATA_DIR, file).padEnd(55)} ${Math.round(before/1024)}KB → ${Math.round(after/1024)}KB  (-${pct}%)`);
    } else {
      fs.unlinkSync(tmp);
      console.log(`  –  ${path.relative(DATA_DIR, file).padEnd(55)} already optimal (${Math.round(before/1024)}KB)`);
    }
  }

  // ── Convert PNGs → JPEG ──────────────────────────────────────────
  for (const file of pngs) {
    const before = fs.statSync(file).size;
    const jpgFile = file.replace(/\.png$/i, '.jpg');
    await sharp(file)
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_Q, mozjpeg: true })
      .toFile(jpgFile);
    const after = fs.statSync(jpgFile).size;
    fs.unlinkSync(file);
    savedBytes += before - after;
    const pct = Math.round((1 - after / before) * 100);
    console.log(`  ✓  ${path.relative(DATA_DIR, file).padEnd(55)} ${Math.round(before/1024)}KB → ${Math.round(after/1024)}KB  (PNG→JPG -${pct}%)`);
    pngRenames.push({ from: path.basename(file), to: path.basename(jpgFile) });
  }

  // ── Patch HTML references .png → .jpg ────────────────────────────
  if (pngRenames.length > 0) {
    console.log(`\nPatching HTML references for ${pngRenames.length} renamed files…`);
    const htmlFiles = fs.readdirSync(WWW_DIR).filter(f => f.endsWith('.html')).map(f => path.join(WWW_DIR, f));
    for (const htmlFile of htmlFiles) {
      let src = fs.readFileSync(htmlFile, 'utf8');
      let changed = false;
      for (const { from, to } of pngRenames) {
        // Escape special chars for regex
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'g');
        if (re.test(src)) {
          src = src.replace(new RegExp(escaped, 'g'), to);
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(htmlFile, src, 'utf8');
        console.log(`  ✓  Patched ${path.basename(htmlFile)}`);
      }
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Total saved: ${(savedBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`${'─'.repeat(70)}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
