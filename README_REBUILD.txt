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

Seasonal homepage updates:
- data/events.json is loaded in the browser at startup; the copy in assets/app.js is a failure fallback only.
- Each event can have a promotion object with a label, priority, colours and one or more start/end windows.
- Recurring windows use MM-DD dates. Optional years limit one-off tournament campaigns such as the World Cup and Euros.
- The highest-priority active event becomes the homepage hero, first template card and default builder selection. Other active events follow it.
- Preview a campaign without changing the clock by adding ?previewDate=YYYY-MM-DD to the homepage URL.
- The homepage title and metadata stay generic for stable SEO; each event page keeps its own indexable search copy.
- Seasonal timing is automatic. Team, player and contestant lists are not pulled from third-party feeds, so review those options in data/events.json before each event.

All draw and CSV download features are free to use; there is no separate paid-download flow.
Sweepstake Wheel is funded through advertising and eligible Amazon affiliate purchases.

Source marker in index.html:
SWEEPSTAKEWHEEL_V2_FULL_REBUILD
