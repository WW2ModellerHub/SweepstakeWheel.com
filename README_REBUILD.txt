SweepstakeWheel.com V2 rebuild
Generated: 2026-10-10T10:22:39

What changed:
- Full-width homepage with event cards and search/filtering.
- Clean sweepstake builder: choose template, add entrants, edit options, load draw, spin one or auto draw.
- Multiple sweepstake templates are stored in /data/events.json and mirrored inside /assets/app.js as a safe fallback.
- Paid export flow preserved using Buy Me a Coffee product:
  https://buymeacoffee.com/sweepstakewheel/e/542346
- Normal support link preserved:
  https://buymeacoffee.com/sweepstakewheel
- Copy Results is not included.
- Old flat event URLs redirect to new folder URLs where possible.
- Google Analytics ID preserved: G-SV4FCEKD9C.
- AdSense publisher ID preserved: ca-pub-2707875272714409.

Important:
Upload the whole contents of this ZIP to the GitHub Pages repo root.
Because this is a rebuild, delete old unused files from the repo if GitHub leaves them behind.
Source marker in HTML:
SWEEPSTAKEWHEEL_V2_FULL_REBUILD

Checks run:
- app.js syntax checked with node --check.
- index.html created.
- event pages created.
- sitemap and robots created.
