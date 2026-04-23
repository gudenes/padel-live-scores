import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFipEventPageConfig } from '../../parsers/fip-event-page-config.js';

describe('parseFipEventPageConfig', () => {
  it('extracts ajaxUrl, nonce, and postId from the real Brussels event page', () => {
    const html = readFileSync(
      join(__dirname, '../fixtures/fip-draw/brussels-event-page.html'),
      'utf-8'
    );
    const config = parseFipEventPageConfig(html);
    expect(config).not.toBeNull();
    expect(config!.ajaxUrl).toBe('https://www.padelfip.com/wp-admin/admin-ajax.php');
    // Nonce is a 10-char hex string (WP convention). Don't pin the exact
    // value — nonces rotate. Just confirm the shape.
    expect(config!.nonce).toMatch(/^[a-f0-9]{8,}$/);
    // Post IDs are numeric.
    expect(config!.postId).toMatch(/^\d+$/);
  });

  it('returns null when padelfip_ajax is missing', () => {
    const html = `
      <script>
        var ajax_object = {"ajax_url":"https://example.com/wp-admin/admin-ajax.php","post_id":"12345"};
      </script>`;
    expect(parseFipEventPageConfig(html)).toBeNull();
  });

  it('returns null when ajax_object is missing', () => {
    const html = `
      <script>
        var padelfip_ajax = {"ajax_url":"https://example.com/wp-admin/admin-ajax.php","nonce":"abc123"};
      </script>`;
    expect(parseFipEventPageConfig(html)).toBeNull();
  });

  it('returns null when JSON parsing fails (malformed block)', () => {
    const html = `var padelfip_ajax = {not json};
                  var ajax_object = {"ajax_url":"x","post_id":"1"};`;
    expect(parseFipEventPageConfig(html)).toBeNull();
  });

  it('extracts from a minimal valid script pair', () => {
    const html = `
      <html><body><script>
        var padelfip_ajax = {"ajax_url":"https://example.com/admin-ajax.php","nonce":"abc123def"};
        var ajax_object = {"ajax_url":"https://example.com/admin-ajax.php","post_id":"999"};
      </script></body></html>`;
    const config = parseFipEventPageConfig(html);
    expect(config).toEqual({
      ajaxUrl: 'https://example.com/admin-ajax.php',
      nonce: 'abc123def',
      postId: '999',
    });
  });
});
