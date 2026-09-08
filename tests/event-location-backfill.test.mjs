import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUfcEventLocation, parsePlaceText } from '../scripts/backfill-event-locations.mjs';

test('parses UFC meta description for a US arena', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:description" content="Don't Miss A Moment Of Noche UFC, Live From Desert Diamond Arena In Glendale, Arizona On September 12, 2026.">
  </head><body>Desert Diamond Arena, Glendale United States</body></html>`;
  assert.deepEqual(extractUfcEventLocation(html), {
    venue:'Desert Diamond Arena',city:'Glendale',region:'Arizona',country:'US',source:'meta-description'
  });
});

test('parses international UFC meta description', () => {
  const html = `<!doctype html><html><head>
    <meta name="description" content="Don't Miss A Moment Of UFC Paris, Live From Accor Arena In Paris, France On September 5, 2026.">
  </head><body>Accor Arena, Paris France</body></html>`;
  assert.deepEqual(extractUfcEventLocation(html), {
    venue:'Accor Arena',city:'Paris',region:null,country:'FR',source:'meta-description'
  });
});

test('uses official JSON-LD location when present', () => {
  const html = `<!doctype html><html><head>
    <script type="application/ld+json">${JSON.stringify({
      '@context':'https://schema.org','@type':'SportsEvent',name:'UFC 331',
      location:{'@type':'Place',name:'Crypto.com Arena',address:{'@type':'PostalAddress',addressLocality:'Los Angeles',addressRegion:'CA',addressCountry:'US'}}
    })}</script>
  </head><body>Crypto.com Arena Los Angeles United States</body></html>`;
  assert.deepEqual(extractUfcEventLocation(html), {
    venue:'Crypto.com Arena',city:'Los Angeles',region:'CA',country:'US',source:'json-ld'
  });
});

test('fills country from visible UFC page text when meta only names the city', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:description" content="Don't Miss A Moment Of UFC 323, Live From T-Mobile Arena In Las Vegas On December 6, 2025.">
  </head><body><div>T-Mobile Arena, Las Vegas United States</div></body></html>`;
  assert.deepEqual(extractUfcEventLocation(html), {
    venue:'T-Mobile Arena',city:'Las Vegas',region:null,country:'US',source:'meta-description'
  });
});

test('parses city, region and country for multi-part international locations', () => {
  assert.deepEqual(parsePlaceText('Perth, Western Australia, Australia'), {
    city:'Perth',region:'Western Australia',country:'AU'
  });
  assert.deepEqual(parsePlaceText('Montréal, Québec, Canada'), {
    city:'Montréal',region:'Québec',country:'CA'
  });
});
