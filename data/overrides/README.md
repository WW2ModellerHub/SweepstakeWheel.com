# Event data overrides

Place a reviewed JSON file named `<event-slug>.json` here to override an automatic provider result. An override must contain an `options` array and a current ISO 8601 `checkedAt` value. It may also include `edition`, `sourceName`, `sourceUrl` and `validUntil`.

The maintenance job validates the list, edition and review age before using it. An invalid, expired or empty override never replaces the last known-good list and never blocks a healthy automatic provider.
