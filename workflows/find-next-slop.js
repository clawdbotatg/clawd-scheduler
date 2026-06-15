// Read-only. Finds upcoming slop.computer episodes via Calendar search and
// identifies the NEXT one whose location link is still a TODO placeholder.
//
// Run standalone:  node workflows/find-next-slop.js
// Or import { findNextSlopNeedingLink } and use the structured result.
import { connectCDP } from '../lib/connect.js';

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseTimeTo24(t) {
  // "9:30am" / "12pm" -> {h, m}
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/i);
  if (!m) return { h: 0, m: 0 };
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const pm = m[3].toLowerCase() === 'p';
  if (h === 12) h = pm ? 12 : 0;
  else if (pm) h += 12;
  return { h, m: min };
}

function parseAriaLabel(label) {
  const dateM = label.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  const timeM = label.match(/(\d{1,2}(?::\d{2})?[ap]m)\s+to\s+(\d{1,2}(?::\d{2})?[ap]m)/i);
  const locM = label.match(/Location:\s*(https?:\/\/\S+?)(?:,\s*[A-Z][a-z]+\s+\d{1,2},|\s*$)/i);
  const titleM = label.match(/[ap]m,\s*(.+?),\s*Austin Griffith/i);

  let start = null;
  if (dateM && timeM) {
    const mon = MONTHS[dateM[1].toLowerCase()];
    const { h, m } = parseTimeTo24(timeM[1]);
    if (mon !== undefined) start = new Date(parseInt(dateM[3]), mon, parseInt(dateM[2]), h, m);
  }
  const location = locM ? locM[1] : (/No location/i.test(label) ? null : null);

  return {
    raw: label,
    title: titleM ? titleM[1].trim() : '(unknown)',
    date: dateM ? `${dateM[1]} ${dateM[2]}, ${dateM[3]}` : null,
    timeRange: timeM ? `${timeM[1]}–${timeM[2]}` : null,
    start, // Date or null
    startISO: start ? start.toISOString() : null,
    location,
  };
}

function classify(ev) {
  const loc = ev.location || '';
  const isEpisode = /slop\.computer/i.test(loc); // real episodes carry a slop.computer room link
  const hasRealLink = /live\.slop\.computer\/\S+invite=/i.test(loc);
  const needsLink = isEpisode && (!hasRealLink || /todo/i.test(loc));
  return { isEpisode, hasRealLink, needsLink };
}

// Runs the calendar search on an ALREADY-CONNECTED page (no connection mgmt),
// so an orchestrator can reuse one clone session across steps.
export async function searchSlopEpisodes(page) {
  await page.goto('https://calendar.google.com/calendar/u/0/r/search?q=slop.computer', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(4000);

  const labels = await page.evaluate(() => {
    const out = [], seen = new Set();
    for (const el of document.querySelectorAll('[role="button"][aria-label], a[aria-label]')) {
      const t = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (!t || !/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  });

  const now = new Date();
  const events = labels
    .map(parseAriaLabel)
    .map((e) => ({ ...e, ...classify(e) }))
    .filter((e) => e.start)
    .sort((a, b) => a.start - b.start);

  const upcomingEpisodes = events.filter((e) => e.isEpisode && e.start >= now);
  const episodesNeedingLink = upcomingEpisodes.filter((e) => e.needsLink);
  const nextNeedingLink = episodesNeedingLink[0] || null;

  return { now: now.toISOString(), all: events, upcomingEpisodes, episodesNeedingLink, nextNeedingLink };
}

export async function findNextSlopNeedingLink(port = 9223) {
  const { browser, page } = await connectCDP(port);
  try {
    return await searchSlopEpisodes(page);
  } finally {
    await browser.close();
  }
}

// Standalone run
if (import.meta.url === `file://${process.argv[1]}`) {
  const { now, upcomingEpisodes, nextNeedingLink } = await findNextSlopNeedingLink();
  console.log(`now: ${now}\n`);
  console.log('Upcoming slop.computer episodes:');
  for (const e of upcomingEpisodes) {
    const tag = e.needsLink ? '⚠ TODO link' : '✅ link set';
    console.log(`  ${e.date?.padEnd(15)} ${(e.timeRange || '').padEnd(16)} ${e.title.padEnd(34)} ${tag}`);
    console.log(`      location: ${e.location}`);
  }
  console.log('\n➡ NEXT EPISODE NEEDING A LINK:');
  console.log(nextNeedingLink ? JSON.stringify(
    {
      title: nextNeedingLink.title,
      date: nextNeedingLink.date,
      timeRange: nextNeedingLink.timeRange,
      startISO: nextNeedingLink.startISO,
      location: nextNeedingLink.location,
    }, null, 2) : '  (none found)');
}
