-- Venue auto-detect for the CPS "Paste Info" box (2026-10-19).
-- map_links: one or more Google Maps share links for the venue (space / comma /
--   newline separated). Google issues a new short link on every share, so a venue
--   can carry several.
-- aliases:   comma-separated names agents use for the venue ("MBB", "御書閣").
alter table public.venues add column if not exists map_links text;
alter table public.venues add column if not exists aliases text;

update public.venues set map_links = v.links, aliases = v.aliases, updated_at = now()
from (values
  (1775714413136::bigint, 'https://maps.app.goo.gl/75Lb2oTjBnWpeNYMA https://maps.app.goo.gl/evV979LDVe8E4p4B6', 'MBB, Menara Bangkok Bank, Bangkok Bank'),
  (1775714507547, 'https://maps.app.goo.gl/kjpZvtJSUc9TbZWF6', 'Monalisa, Monalisa Book Store, 御書閣, 御书阁'),
  (1775714531359, 'https://maps.app.goo.gl/LRAZ1qDh8zzueERx8', 'Far Coffee Bukit Jalil'),
  (1775714523003, 'https://maps.app.goo.gl/8hPMcuuPchVtSBhJ8', 'Formula Healthcare, Formula Healthcare Sdn Bhd'),
  (1775714544419, 'https://maps.app.goo.gl/P7xzsZadmiP4bW519', 'Florida Western Food, Florida Bukit Jalil, Florida 001'),
  (1785823791854001, 'https://maps.app.goo.gl/QJV2u8ws3xRKVLsPA', 'Centrium Square, Centrium, 320 Serangoon'),
  (1775714560522, null, 'Far Coffee Sunway, Sunway Square')
) as v(id, links, aliases)
where public.venues.id = v.id;
