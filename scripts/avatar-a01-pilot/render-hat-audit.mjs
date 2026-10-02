#!/usr/bin/env node
/** Render the app's actual SVG composition for visual hat QA; does not modify artwork. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { renderAvatar, profiles } from '../../src/lib/avatar-a01-renderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artworkRoot = path.join(root, 'public/play/avatars/a01-local');
const hats = [
  ['club', 'Club Cap'], ['cobalt', 'Blue Visor'], ['sunset', 'Sun Rally'],
  ['champion', 'Champion Cap'], ['backwards', 'Reverse Rally'], ['bandana', 'Court Bandana'],
];
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));
const decode = value => value.replace(/&(?:amp|lt|gt|quot|apos);/g, s => ({'&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'"}[s]));

function options(args) {
  let outputDir = path.join(root, 'output/hat-audit');
  let selected = [];
  let candidateVersion;
  let mixed = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/avatar-a01-pilot/render-hat-audit.mjs [face-03 face-09] [--avatars face-03,face-09] [--output-dir output/hat-audit] [--candidate-version v6] [--mixed]\nDefaults to all avatars. Generates labeled close-up/full-body PNGs and source manifests.');
      process.exit(0);
    }
    if (arg === '--mixed') { mixed = true; continue; }
    if (arg === '--output-dir' || arg === '--avatars' || arg === '--candidate-version') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--output-dir') outputDir = path.resolve(process.cwd(), value);
      else if (arg === '--candidate-version') {
        if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Invalid candidate version');
        candidateVersion = value;
      } else selected.push(...value.split(','));
    } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else selected.push(...arg.split(','));
  }
  if (!selected.length) selected = Object.keys(profiles).sort();
  selected = [...new Set(selected)];
  for (const avatar of selected) if (!profiles[avatar]) throw new Error(`Unknown avatar: ${avatar}`);
  return { outputDir, selected, candidateVersion, mixed };
}

const imageCache = new Map();
async function embeddedImage(relative) {
  if (imageCache.has(relative)) return imageCache.get(relative);
  const filename = path.resolve(artworkRoot, relative);
  if (!filename.startsWith(artworkRoot + path.sep)) throw new Error(`Image outside artwork root: ${relative}`);
  const bytes = await fs.readFile(filename).catch(error => { throw new Error(`Missing/unreadable artwork ${filename}: ${error.message}`); });
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Invalid image dimensions: ${filename}`);
  // Decode every referenced source, including full-body PNGs, before writing any sheet.
  const stats = await sharp(bytes).ensureAlpha().stats();
  if (stats.channels[stats.channels.length - 1].max === 0) throw new Error(`Fully transparent artwork: ${filename}`);
  // librsvg may not decode embedded WebP; audit the decoded production pixels as PNG.
  const raster = metadata.format === 'webp' ? await sharp(bytes).png().toBuffer() : bytes;
  const mime = metadata.format === 'webp' ? 'image/png' : metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;
  const result = { uri: `data:${mime};base64,${raster.toString('base64')}`, width: metadata.width, height: metadata.height, bytes: bytes.length };
  imageCache.set(relative, result);
  return result;
}

async function renderTile(avatar, hat, portrait, config) {
  const candidatePath = config.candidateVersion ? `characters/${avatar}-${hat}-fitted-${config.candidateVersion}.png` : null;
  let candidate = false;
  if (candidatePath) {
    try { await fs.access(path.join(artworkRoot, candidatePath)); candidate = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const outfit = config.mixed ? {shirt:'cobalt', shorts:'sunset', shoes:'club', wrist:'cobalt', racket:'champion'} : {};
  const input = { avatar, outfit: { ...outfit, hat: candidate ? 'starter' : hat }, id: `audit-${avatar}-${hat}-${portrait ? 'head' : 'full'}`, portrait, base: '' };
  const draft = renderAvatar(input);
  const sources = [...new Set([...draft.matchAll(/<image\b[^>]*\bhref="([^"]+)"/g)].map(match => decode(match[1])))];
  if (!sources.some(source => source.startsWith('characters/'))) throw new Error(`No character source for ${avatar}/${hat}`);
  const images = {};
  for (const source of sources) images[source] = (await embeddedImage(candidate && source === `characters/${avatar}.webp` ? candidatePath : source)).uri;
  const svg = renderAvatar({ ...input, images });
  const unresolved = [...svg.matchAll(/<image\b[^>]*\bhref="([^"]+)"/g)].some(match => !match[1].startsWith('data:image/'));
  if (unresolved) throw new Error(`Unembedded image reference for ${avatar}/${hat}`);
  const buffer = await sharp(Buffer.from(svg)).resize(portrait ? 420 : 300, portrait ? 420 : 450).png().toBuffer();
  return { buffer, sources: sources.map(source => candidate && source === `characters/${avatar}.webp` ? candidatePath : source), mode: candidate ? 'candidate' : config.candidateVersion ? 'fallback' : 'current' };
}

async function sheet(avatar, portrait, config) {
  const tileWidth = portrait ? 440 : 300;
  const tileHeight = portrait ? 470 : 500;
  const width = portrait ? tileWidth * 3 : tileWidth * 6;
  const height = portrait ? tileHeight * 2 + 50 : tileHeight + 50;
  const foreground = portrait ? '#24261f' : '#eeeeDF';
  const layers = [];
  const evidence = [];
  let labels = `<text x="16" y="30" font-size="22">${escape(profiles[avatar].name)} · ${avatar} · ${portrait ? 'Close-up' : 'Full body'}</text>`;
  for (let i = 0; i < hats.length; i++) {
    const [hat, label] = hats[i];
    const { buffer, sources, mode } = await renderTile(avatar, hat, portrait, config);
    const left = portrait ? (i % 3) * tileWidth : i * tileWidth;
    const top = 50 + (portrait ? Math.floor(i / 3) * tileHeight : 0);
    layers.push({ input: buffer, left: left + (portrait ? 10 : 0), top: top + 32 });
    labels += `<text x="${left + 12}" y="${top + 22}" font-size="18">${escape(label)}${mode === 'candidate' ? ' · candidate' : mode === 'fallback' ? ' · fallback' : ''}</text>`;
    evidence.push({ hat, label, mode, sources });
  }
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="${foreground}" font-family="sans-serif">${labels}</g></svg>`), left: 0, top: 0 });
  const buffer = await sharp({ create: { width, height, channels: 4, background: portrait ? '#ededdf' : '#24261f' } }).composite(layers).png().toBuffer();
  return { buffer, evidence };
}

try {
  const config = options(process.argv.slice(2));
  const { outputDir, selected, candidateVersion, mixed } = config;
  await fs.mkdir(outputDir, { recursive: true });
  for (const avatar of selected) {
    const close = await sheet(avatar, true, config);
    const full = await sheet(avatar, false, config);
    const prefix = path.join(outputDir, `hat-audit-${avatar}`);
    await fs.writeFile(`${prefix}-rendered.png`, close.buffer);
    await fs.writeFile(`${prefix}-full.png`, full.buffer);
    await fs.writeFile(`${prefix}-sources.json`, JSON.stringify({ avatar, name: profiles[avatar].name, candidateVersion, mixed, renderer: 'src/lib/avatar-a01-renderer.mjs', generatedAt: new Date().toISOString(), evidence: close.evidence }, null, 2) + '\n');
    console.log(`${profiles[avatar].name}: ${prefix}-{rendered,full}.png`);
  }
} catch (error) {
  console.error(`Hat audit failed: ${error.message}`);
  process.exitCode = 1;
}
