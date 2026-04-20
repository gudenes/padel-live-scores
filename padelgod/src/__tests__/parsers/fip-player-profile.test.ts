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
});
