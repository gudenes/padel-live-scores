import { describe, it, expect } from 'vitest';
import { parseFipPlayerProfile } from '../../parsers/fip-player-profile.js';

describe('parseFipPlayerProfile', () => {
  it('extracts fip_id, JSON-LD fields, and equipment', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{
          "@context": "https://schema.org",
          "@type": "Person",
          "name": "Gabriel Elia Curcio",
          "birthDate": "2008-03-12",
          "birthPlace": { "@type": "Place", "name": "Buenos Aires" },
          "height": "180 cm",
          "affiliation": { "@type": "Organization", "name": "AAP" }
        }</script>
      </head><body>
        <span data-fip-id="P217132">P217132</span>
        <section class="player-equipment">
          <h2>RACKET and BALL</h2>
          <div class="racket-brand">Bullpadel</div>
          <div class="racket-model">Vertex 04 Comfort</div>
        </section>
      </body></html>
    `;
    const result = parseFipPlayerProfile(html);
    expect(result.fipId).toBe('P217132');
    expect(result.birthDate).toBe('2008-03-12');
    expect(result.birthPlace).toBe('Buenos Aires');
    expect(result.heightCm).toBe(180);
    expect(result.affiliation).toBe('AAP');
    expect(result.racketBrand).toBe('Bullpadel');
    expect(result.racketModel).toBe('Vertex 04 Comfort');
  });

  it('returns nulls when fields are missing', () => {
    const result = parseFipPlayerProfile('<html><body></body></html>');
    expect(result.fipId).toBeNull();
    expect(result.birthDate).toBeNull();
    expect(result.heightCm).toBeNull();
    expect(result.racketBrand).toBeNull();
    expect(result.coaches).toEqual([]);
  });

  it('extracts coaches from .overview__coaches', () => {
    // Real FIP HTML shape (verified against padelfip.com/player/arturo-coello/)
    const html = `
      <html><body>
        <div class="overview__mirror">
          <span class="overview__title">Coaches</span>
          <div class="overview__coaches">
            <p class="overview__text">Gustavo Pratto</p>
            <p class="overview__text">Martin Canali</p>
          </div>
        </div>
      </body></html>
    `;
    const result = parseFipPlayerProfile(html);
    expect(result.coaches).toEqual(['Gustavo Pratto', 'Martin Canali']);
  });

  it('handles a single coach', () => {
    const html = `
      <div class="overview__coaches">
        <p class="overview__text">Juan Martin Diaz</p>
      </div>
    `;
    const result = parseFipPlayerProfile(html);
    expect(result.coaches).toEqual(['Juan Martin Diaz']);
  });

  it('skips empty coach entries', () => {
    const html = `
      <div class="overview__coaches">
        <p class="overview__text">Gustavo Pratto</p>
        <p class="overview__text">   </p>
        <p class="overview__text"></p>
      </div>
    `;
    const result = parseFipPlayerProfile(html);
    expect(result.coaches).toEqual(['Gustavo Pratto']);
  });

  // The current production padelfip.com pages use Yoast SEO's @graph schema
  // (verified against /player/maximiliano-arce-simo/ on 2026-05-09). The
  // Person bio fields are nested under graph[].mainEntity, not at the top
  // level. Height is a decimal meters string ("1.75"), not "180 cm".
  it("extracts Person fields from Yoast's @graph schema (real FIP shape)", () => {
    const html = `
      <html><head>
        <script type="application/ld+json" class="yoast-schema-graph">{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": ["WebPage", "ProfilePage"],
              "@id": "https://www.padelfip.com/player/maximiliano-arce-simo/",
              "mainEntity": {
                "@type": "Person",
                "name": "Maximiliano Arce Simo",
                "birthDate": "1998-01-27",
                "birthPlace": { "@type": "Place", "name": "Salta" },
                "height": "1.75",
                "affiliation": { "@type": "Organization", "name": "FIP" }
              }
            },
            { "@type": "WebSite" },
            { "@type": "Organization" }
          ]
        }</script>
      </head><body></body></html>
    `;
    const result = parseFipPlayerProfile(html);
    expect(result.birthDate).toBe('1998-01-27');
    expect(result.birthPlace).toBe('Salta');
    expect(result.heightCm).toBe(175);
    expect(result.affiliation).toBe('FIP');
  });

  it('parses height in decimal meters (1.75 → 175 cm)', () => {
    const html = `<script type="application/ld+json">{
      "@type": "Person", "height": "1.75"
    }</script>`;
    expect(parseFipPlayerProfile(html).heightCm).toBe(175);
  });

  it('parses height with comma decimal (1,80 → 180 cm)', () => {
    const html = `<script type="application/ld+json">{
      "@type": "Person", "height": "1,80"
    }</script>`;
    expect(parseFipPlayerProfile(html).heightCm).toBe(180);
  });

  it('parses height as raw cm integer (175 → 175 cm)', () => {
    const html = `<script type="application/ld+json">{
      "@type": "Person", "height": "175"
    }</script>`;
    expect(parseFipPlayerProfile(html).heightCm).toBe(175);
  });

  it('keeps backwards-compat height in "180 cm" form', () => {
    const html = `<script type="application/ld+json">{
      "@type": "Person", "height": "180 cm"
    }</script>`;
    expect(parseFipPlayerProfile(html).heightCm).toBe(180);
  });

  it('rejects garbage height values', () => {
    expect(parseFipPlayerProfile(
      `<script type="application/ld+json">{"@type":"Person","height":"unknown"}</script>`
    ).heightCm).toBeNull();
    // Decimal too small to be a real human height
    expect(parseFipPlayerProfile(
      `<script type="application/ld+json">{"@type":"Person","height":"0.5"}</script>`
    ).heightCm).toBeNull();
    // Integer too small
    expect(parseFipPlayerProfile(
      `<script type="application/ld+json">{"@type":"Person","height":"50"}</script>`
    ).heightCm).toBeNull();
  });
});
