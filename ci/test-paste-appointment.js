// ci/test-paste-appointment.js — CPS "Paste Info" extras (2026-10-19):
// appointment date / time / venue from the pasted message, and Title from
// gender + marital status.
//
// HARNESS: functions are SLICED OUT OF THE REAL SOURCE and eval'd (same pattern
// as test-basic-info-selects.js / test-ming-gua.js), never copied.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const eq = (name, got, want) => {
    if (got === want) { pass++; return; }
    fail++;
    console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
};
const act = fs.readFileSync(path.join(ROOT, 'chunks/script-activities.js'), 'utf8');
const slice = (decl, end = '\n    };') => {
    const start = act.indexOf(decl);
    if (start === -1) throw new Error('not found: ' + decl);
    return act.slice(start + decl.length, act.indexOf(end, start) + end.length - 1);
};
const _MONTHS = eval('(' + slice('    const _MONTHS = ', '};') + ')');
const _ymd = eval('(' + slice('    const _ymd = ') + ')');
const _biGender = eval('(' + slice('    const _biGender = ') + ')');
const parseApptDate = eval('(' + slice('    const parseApptDate = ') + ')');
const parseApptTime = eval('(' + slice('    const parseApptTime = ') + ')');
const _normLink = eval('(' + slice('    const _normLink = ', ';\n').replace(/;$/, '') + ')');
const _normText = eval('(' + slice('    const _normText = ', ';\n').replace(/;$/, '') + ')');
const matchVenue = eval('(' + slice('    const matchVenue = ') + ')');
const autoTitle = eval('(' + slice('    const autoTitle = ') + ')');
const _googleMapLinks = eval('(' + slice('    const _googleMapLinks = ', ';\n').replace(/;$/, '') + ')');
const nearestVenue = eval('(' + slice('    const nearestVenue = ') + ')');
const resolveVenueFromLink = eval('(' + slice('    const resolveVenueFromLink = ') + ')');
// Edge Function pure helpers (supabase/functions/resolve-map-link/index.ts).
const fnSrc = fs.readFileSync(path.join(ROOT, 'supabase/functions/resolve-map-link/index.ts'), 'utf8');
const fnPure = fnSrc.slice(fnSrc.indexOf('const isAllowedMapsUrl'), fnSrc.indexOf('// ── END PURE HELPERS'));
const { isAllowedMapsUrl, parseMapsUrl } = new Function(fnPure + '\nreturn { isAllowedMapsUrl, parseMapsUrl };')();

const SHARON = `请填妥基本资料 Basic information

1. 姓名 Name : Sharon Khor
2. 身分号码 IC: 840831025324
3. 职业 Occupation: self employed
4. 联络号码 Phone no: 0176349438
5. 邮箱 Email: Sharonkhorinhouse@yahoo.com

需要穿著端正，長褲包鞋 Proper attire required
(No slipper & short pant)

Date & Time
10am Wednesday, 21 Oct

Location
https://maps.app.goo.gl/evV979LDVe8E4p4B6`;

// ── Date ────────────────────────────────────────────────────────────────────
const T = new Date('2026-10-19T09:00:00');
eq('Sharon date', parseApptDate(SHARON, T), '2026-10-21');
eq('21 October 2026', parseApptDate('on 21 October 2026', T), '2026-10-21');
eq('Oct 21', parseApptDate('Oct 21, 3pm', T), '2026-10-21');
eq('21st Oct', parseApptDate('21st Oct', T), '2026-10-21');
eq('21/10', parseApptDate('Date: 21/10', T), '2026-10-21');
eq('21/10/2026', parseApptDate('21/10/2026', T), '2026-10-21');
eq('ISO', parseApptDate('2026-10-21', T), '2026-10-21');
eq('Chinese 10月21日', parseApptDate('10月21日 星期三', T), '2026-10-21');
eq('past date this year stays (caller asks)', parseApptDate('18 Oct', T), '2026-10-18');
eq('Dec message about Jan → next year', parseApptDate('5 Jan', new Date('2026-12-20T09:00:00')), '2027-01-05');
eq('31 Feb → none', parseApptDate('31 Feb', T), '');
eq('IC digits are not a date', parseApptDate('IC: 840831025324 phone 0176349438', T), '');
eq('no date', parseApptDate('hello', T), '');

// ── Time ────────────────────────────────────────────────────────────────────
eq('Sharon time', parseApptTime(SHARON), '10:00');
eq('2:30pm', parseApptTime('2:30pm'), '14:30');
eq('10.30 am', parseApptTime('10.30 am'), '10:30');
eq('12pm', parseApptTime('12pm'), '12:00');
eq('12am', parseApptTime('12am'), '00:00');
eq('14:30', parseApptTime('at 14:30'), '14:30');
eq('下午3点半', parseApptTime('下午3点半'), '15:30');
eq('上午10点', parseApptTime('上午10点'), '10:00');
eq('晚上8点', parseApptTime('晚上8点'), '20:00');
eq('no time', parseApptTime('IC: 840831025324'), '');

// ── Venue (rows mirror the live venues table, 2026-10-19) ───────────────────
const V = [
    { id: 1, name: 'Menara Bangkok Bank DC HQ', location: 'KL', waze_link: 'https://waze.com/ul/hw283fqe7z',
      map_links: 'https://maps.app.goo.gl/75Lb2oTjBnWpeNYMA https://maps.app.goo.gl/evV979LDVe8E4p4B6', aliases: 'MBB, Menara Bangkok Bank, Bangkok Bank' },
    { id: 2, name: 'Monalisa Bookstore', location: 'Bukit Jalil, KL', map_links: 'https://maps.app.goo.gl/kjpZvtJSUc9TbZWF6', aliases: 'Monalisa, Monalisa Book Store, 御書閣, 御书阁' },
    { id: 3, name: 'Far Coffee', location: 'Bukit Jalil', map_links: 'https://maps.app.goo.gl/LRAZ1qDh8zzueERx8', aliases: 'Far Coffee Bukit Jalil' },
    { id: 4, name: 'Far Coffee', location: 'Sunway Square, Selangor', map_links: null, aliases: 'Far Coffee Sunway, Sunway Square' },
    { id: 5, name: 'Florida 001', location: 'Bukit Jalil KL', map_links: 'https://maps.app.goo.gl/P7xzsZadmiP4bW519', aliases: 'Florida Western Food, Florida Bukit Jalil, Florida 001' },
    { id: 6, name: 'Florida001 PG', location: 'Bay Avenue, Bayan Lepas, Penang', map_links: null, aliases: null },
    { id: 7, name: 'DC SG Office Centrium Square', location: 'SG', map_links: 'https://maps.app.goo.gl/QJV2u8ws3xRKVLsPA', aliases: 'Centrium Square, Centrium, 320 Serangoon' },
    { id: 8, name: '豐展廳', location: 'Bay Avenue, Bayan Lepas, Penang', map_links: null, aliases: null },
];
const vid = (t) => (matchVenue(t, V) || {}).id || null;
eq('Sharon link → MBB', vid(SHARON), 1);
eq('other MBB link', vid('Location https://maps.app.goo.gl/75Lb2oTjBnWpeNYMA'), 1);
eq('link with ?g_st query', vid('https://maps.app.goo.gl/kjpZvtJSUc9TbZWF6?g_st=iw'), 2);
eq('Waze link', vid('https://waze.com/ul/hw283fqe7z'), 1);
eq('"MBB" in text', vid('Location: MBB level 23'), 1);
eq('"Menara Bangkok Bank" in text', vid('Menara Bangkok Bank 1-23-5, Jln Ampang'), 1);
eq('御書閣', vid('地点：御書閣'), 2);
eq('Far Coffee Bukit Jalil beats Sunway', vid('Far Coffee Bukit Jalil'), 3);
eq('Far Coffee Sunway', vid('Far Coffee Sunway Square'), 4);
eq('plain "Far Coffee" is ambiguous → none', vid('meet at Far Coffee'), null);
eq('Florida Western Food', vid('Florida Western Food (Bukit Jalil City)'), 5);
eq('Centrium', vid('Centrium Square320 Serangoon Rd'), 7);
eq('豐展廳 (CJK)', vid('在豐展廳见'), 8);
eq('unknown link → none', vid('https://maps.app.goo.gl/zzzzzzzzzzzzzzzz'), null);
eq('"mbbs" is not MBB', vid('my son studies mbbs'), null);
eq('nothing', vid('hello'), null);

// ── Fresh Google link → resolver (2026-10-19) ───────────────────────────────
// Real 302 targets of two MBB share links (captured 2026-10-19).
const MBB_A = 'https://www.google.com/maps/place/Menara+Bangkok+Bank+%7C+Berjaya+Central+Park,+105,+Jln+Ampang,+Kuala+Lumpur,+50450+Kuala+Lumpur,+Federal+Territory+of+Kuala+Lumpur/data=!4m2!3m1!1s0x31cc4829f50a843f:0xe32015f7aba67491?utm_source=mstt_1&entry=gps';
const MBB_B = 'https://www.google.com/maps/place/Menara+Bangkok+Bank+Berjaya+Central+Park,+1-23-5,+Jln+Ampang,+Kuala+Lumpur,+50450+Kuala+Lumpur,+Wilayah+Persekutuan+Kuala+Lumpur/@3.1562235,101.7029444,17z/data=!3m1!4b1!4m6!3m5!1s0x31cc482a1fc6b1d1:0xa108b84c1d73d2ff!8m2!3d3.1562181!4d101.7055193!16s%2Fg%2F11vm4pktpx?entry=tts';
const pa = parseMapsUrl(MBB_A), pb = parseMapsUrl(MBB_B);
eq('parse A name', pa.name, 'Menara Bangkok Bank | Berjaya Central Park');
eq('parse A address starts', (pa.address || '').slice(0, 14), '105, Jln Ampan');
eq('parse A no position', pa.lat, null);
eq('parse B name', pb.name, 'Menara Bangkok Bank Berjaya Central Park');
eq('parse B pin lat (not viewport)', pb.lat, 3.1562181);
eq('parse B pin lng', pb.lng, 101.7055193);
eq('parse ?q=lat,lng', JSON.stringify(parseMapsUrl('https://maps.google.com/maps?q=3.15,101.70')), JSON.stringify({ name: null, address: null, lat: 3.15, lng: 101.7 }));
eq('parse ?q=name', parseMapsUrl('https://maps.google.com/?q=Far+Coffee,+Bukit+Jalil').name, 'Far Coffee');
eq('parse junk', parseMapsUrl('not a url').name, null);
// SSRF guard: only https Google Maps hosts.
eq('allow maps.app.goo.gl', isAllowedMapsUrl('https://maps.app.goo.gl/abc'), true);
eq('allow goo.gl/maps', isAllowedMapsUrl('https://goo.gl/maps/abc'), true);
eq('allow google.com/maps', isAllowedMapsUrl(MBB_A), true);
eq('deny goo.gl non-maps', isAllowedMapsUrl('https://goo.gl/abc'), false);
eq('deny http', isAllowedMapsUrl('http://maps.app.goo.gl/abc'), false);
eq('deny other host', isAllowedMapsUrl('https://evil.com/maps/place/x'), false);
eq('deny lookalike host', isAllowedMapsUrl('https://maps.app.goo.gl.evil.com/x'), false);
eq('deny userinfo trick', isAllowedMapsUrl('https://maps.app.goo.gl@169.254.169.254/'), false);
eq('deny port', isAllowedMapsUrl('https://maps.app.goo.gl:8443/x'), false);
eq('deny google.com non-maps', isAllowedMapsUrl('https://www.google.com/url?q=http://x'), false);
// Client: which links go to the resolver.
eq('links: google only', JSON.stringify(_googleMapLinks('a https://maps.app.goo.gl/NEW1). b https://waze.com/ul/x c https://goo.gl/maps/OLD2')), JSON.stringify(['https://maps.app.goo.gl/NEW1', 'https://goo.gl/maps/OLD2']));
// Nearest venue within 150 m.
const VP = [{ id: 1, lat: 3.1562181, lng: 101.7055193 }, { id: 2, lat: 3.0500, lng: 101.6900 }, { id: 3, lat: null, lng: null }];
eq('nearest: same spot', (nearestVenue(3.1562181, 101.7055193, VP) || {}).id, 1);
eq('nearest: ~100 m away', (nearestVenue(3.1571, 101.7055193, VP) || {}).id, 1);
eq('nearest: ~300 m away → none', nearestVenue(3.1589, 101.7055193, VP), null);
eq('nearest: no position', nearestVenue(null, null, VP), null);
eq('nearest: two venues in the same building → none', nearestVenue(3.05173, 101.6712, [{ id: 2, lat: 3.051735, lng: 101.67142 }, { id: 4, lat: 3.0517322, lng: 101.6710291 }]), null);
eq('nearest: null lat venue ignored', nearestVenue(0, 0, [{ id: 9, lat: null, lng: null }]), null);
// resolveVenueFromLink with a stubbed Edge Function (asserts the link it was given).
const stub = (res, want) => async (u) => { if (u !== want) throw new Error('wrong link ' + u); return res; };
const FRESH = 'https://maps.app.goo.gl/FreshShareLink123';
(async () => {
    eq('fresh MBB link → MBB by name', ((await resolveVenueFromLink(FRESH, V, stub({ ok: true, ...pa }, FRESH))) || { venue: {} }).venue.id, 1);
    eq('fresh link → venue by position', ((await resolveVenueFromLink(FRESH, [{ id: 7, name: 'Somewhere', lat: 3.1562, lng: 101.7055 }], stub({ ok: true, name: 'Unknown Tower', address: null, lat: 3.1562181, lng: 101.7055193 }, FRESH))) || { venue: {} }).venue.id, 7);
    eq('fresh link to unknown place → none (never Others)', await resolveVenueFromLink(FRESH, V, stub({ ok: true, name: 'Pavilion KL', address: 'Bukit Bintang', lat: 3.149, lng: 101.713 }, FRESH)), null);
    eq('resolver error → none', await resolveVenueFromLink(FRESH, V, stub({ ok: false, error: 'unresolved' }, FRESH)), null);
    eq('resolver throws → none', await resolveVenueFromLink(FRESH, V, async () => { throw new Error('offline'); }), null);
})().then(() => {

// ── Title ───────────────────────────────────────────────────────────────────
eq('Male → Mr.', autoTitle('Male', ''), 'Mr.');
eq('male married → Mr.', autoTitle('male', 'Married'), 'Mr.');
eq('Female married → Mrs.', autoTitle('Female', 'Married'), 'Mrs.');
eq('Female single → Miss', autoTitle('Female', 'Single'), 'Miss');
eq('Female unknown → Ms.', autoTitle('Female', ''), 'Ms.');
eq('Female widowed → Ms.', autoTitle('F', 'Widowed'), 'Ms.');
eq('no gender → none', autoTitle('', 'Married'), '');

console.log(`test-paste-appointment: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
});
