SweepstakeWheel.com V2
Updated: 2026-10-13

Site features:
- Free browser-based sweepstake generator with individual spins and automatic draws.
- Free CSV download of completed assignments.
- Canonical event landing pages with unique setup guidance, FAQs and internal links.
- Fifteen immersive standalone event pages with distinct themes and event-locked builders.
- Crawlable template directory, sitemap, robots.txt and structured data.
- Amazon UK Associates recommendations using tracking tag sweepstakewheel-21.
- Google AdSense publisher ID ca-pub-2707875272714409.
- Google Analytics measurement ID G-SV4FCEKD9C.
- Legacy event URLs redirect to their canonical folder URLs and are marked noindex.
- Data-driven seasonal homepage focus using the Europe/London date.
- Private Secret Santa name matching with no self-matches and one-at-a-time shared-device reveals.
- Seasonal Amazon recommendations in the homepage hero and immediately below each event hero.
- Scheduled site-data maintenance with validation, last-known-good protection and review alerts.

Seasonal homepage updates:
- data/events.json is loaded in the browser at startup; assets/events-fallback.js is generated from it by scripts/build-derived.mjs.
- Each event can have a promotion object with a label, priority, colours and one or more start/end windows.
- Recurring windows use MM-DD dates. Optional years limit one-off tournament campaigns such as the World Cup and Euros.
- The highest-priority active event becomes the homepage hero and first template card. Specialised tools such as Secret Santa open their dedicated private workflow rather than the generic wheel.
- The homepage Amazon card changes with the seasonal focus while retaining explicit paid-link disclosure.
- Preview a campaign without changing the clock by adding ?previewDate=YYYY-MM-DD to the homepage URL.
- The homepage title and metadata stay generic for stable SEO; each event page keeps its own indexable search copy.
- .github/workflows/site-maintenance.yml runs daily, refreshes approved structured sources, validates every candidate and publishes only verified changes.
- Formula 1 uses the public OpenF1 feed. Football updates activate when FOOTBALL_DATA_API_KEY is added as a repository Actions secret.
- Provider failure, a wrong edition, an unexpected entry count, an empty response, duplicates or suspicious list churn never replace the last-known-good data.
- Approved automatic lists record the edition and a throttled verification date. Tournament cycles advance automatically; stale real-looking lists are checked as well as obvious placeholders.
- Events without a dependable structured feed remain editable. When an active or upcoming list is stale, unconfirmed or unavailable, the workflow maintains one GitHub review issue instead of silently publishing scraped names.
- data/overrides/<event-slug>.json can supply a reviewed manual override with checkedAt. Invalid or expired overrides are ignored and do not block a working provider.
- data/health.json records provider-state changes and a meaningful monthly heartbeat without creating daily no-op commits.

Maintenance commands:
- node scripts/manage-event-data.mjs --no-network
- node scripts/build-derived.mjs
- node scripts/build-derived.mjs --migrate (one-time scaffold repair only)
- node scripts/validate-site.mjs
- node scripts/check-freshness.mjs

All draw and CSV download features are free to use; there is no separate paid-download flow.
Sweepstake Wheel is funded through advertising and eligible Amazon affiliate purchases.

Source marker in index.html:
SWEEPSTAKEWHEEL_V2_FULL_REBUILD
