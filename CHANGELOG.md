# Changelog (fork-specific)

Tracks this fork's own changes on top of each upstream base. See `CLAUDE.md` for the versioning scheme
(`<upstream-version>+fork.<N>`) and the upstream-sync process. Upstream's own changelog is not duplicated
here — see <https://github.com/obsidian-tasks-group/obsidian-tasks/releases>.

## 8.4.0+fork.4 — upstream base `8.4.0`

Fix: day-based postpone increments (the button and its "N days" menu items) now count **business
days**, not calendar days rolled off a weekend at the end. Previously, "by 1/2/3 days" for a task
scheduled just before a weekend all landed on the same following Monday — correct individually, but
confusing and duplicate-looking together. Now each amount lands on its own distinct following business
day (e.g. for a task scheduled on a Friday: by 1 day → Monday, by 2 days → Tuesday, by 3 days →
Wednesday, ...).

- Wording changes to match: "by N days" becomes "by N business days" whenever the setting actually
  changes what the increment means (day-based units, amount > 0). The fixed "tomorrow" item only says
  "next business day" instead when a weekend was actually skipped over — if tomorrow is already a
  weekday, it still just says "tomorrow".
- Week/month increments are unchanged: they still just roll their single final result off a weekend, not
  business-day-count through the whole increment (a "business week"/"business month" isn't a clear
  enough concept to justify counting them that way).

## 8.4.0+fork.3 — upstream base `8.4.0`

Fix: the "Postpone to next business day" setting added in `8.4.0+fork.2` was only wired into
`display()`, the legacy imperative settings UI used solely as a fallback on very old Obsidian. On any
normal (1.13.0+) install, the tab is actually rendered from `getSettingDefinitions()`, so the setting was
completely invisible with no error. Added the missing declarative `postponingGroup()` registration — see
the new note in `CLAUDE.md` about this fork's two parallel settings UIs.

## 8.4.0+fork.2 — upstream base `8.4.0`

Roadmap feature: **postpone to next business day**.

- New setting, "Postpone to next business day" (off by default), under a new "Postponing" section in
  Tasks' settings tab.
- When enabled, applies uniformly to the ⏩ postpone button and every item in its right-click menu (day,
  week and month increments, and the fixed "tomorrow" item): whenever the computed date would land on a
  Saturday or Sunday, it rolls forward to the following Monday instead. The fixed "today" item is
  deliberately exempt — it means "set to today", not a postponement, so it's never moved even if today
  itself is a weekend day.
- The general date-field right-click menu (e.g. quick-setting a Due/Scheduled/Start date directly, not via
  the postpone button) is unaffected — this setting only governs the postpone feature.

## 8.4.0+fork.1 — upstream base `8.4.0`

Fork setup, no user-facing features yet:

- Renamed plugin id from `obsidian-tasks-plugin` to `upgraded-tasks` (`manifest.json`, `package.json`) so it
  can't be confused with, or conflict with, a real Tasks install.
- Pinned locale for urgency number formatting.
- Fixed a Windows path-separator failure in the `MockDataLoader` test.
- Adopted the `<upstream-version>+fork.<N>` versioning scheme documented in `CLAUDE.md`.
