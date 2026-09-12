# Changelog (fork-specific)

Tracks this fork's own changes on top of each upstream base. See `CLAUDE.md` for the versioning scheme
(`<upstream-version>+fork.<N>`) and the upstream-sync process. Upstream's own changelog is not duplicated
here — see <https://github.com/obsidian-tasks-group/obsidian-tasks/releases>.

## 8.4.0+fork.11 — upstream base `8.4.0`

Two more fixes after testing `8.4.0+fork.10`:

- Typing an abbreviated duration ("in 2 h") wasn't rounded the same way as its spelled-out form ("in 2
  hours"), even though chrono itself parses both as the same relative offset: the internal regex that
  decides "is this relative, and therefore roundable" only recognised `hours`/`hrs`, not the bare `h`
  abbreviation, so it silently fell through as "not relative" and skipped rounding. `relativeDurationPattern`
  in `ReminderTimeParser.ts` now recognises `h` too. (A bare `m` for minutes is deliberately not added:
  chrono itself doesn't understand that abbreviation - `in 30 m` fails to parse at all - so there's nothing
  to round there either.)
- The rendered line's "Custom time…" prompt (`ReminderPromptModal`) didn't round a relative offset at all,
  regardless of what was typed - it was calling the plain, always-exact parser rather than
  `resolveTypedReminderTime`, unlike the edit modal's own field (fixed in `fork.10`). Switched it to use the
  same shared, rounding-aware resolver, so "in 30 minutes" now means the same rounded time whether it's
  typed in the edit modal, the "Custom time…" prompt, or picked from the menu. A plain clock time is still
  always exact, everywhere.

## 8.4.0+fork.10 — upstream base `8.4.0`

Two fixes after testing `8.4.0+fork.9`:

- The edit modal's reminder field didn't actually round a typed (or suggestion-filled) relative offset -
  e.g. typing "in 30 minutes" resolved to the exact, unrounded time rather than the rounded time the same
  offset's menu item would apply, so the field and the rendered line's menu disagreed. New
  `resolveTypedReminderTime` (in `ReminderTimeParser.ts`) rounds a relative result to the configured
  increment, same as the menu's quick-picks; used by both the modal's live preview
  (`ReminderEditor.svelte`) and by `EditableTask.applyEdits` on save, so what's shown while typing is what
  actually gets saved. A plain clock time is never rounded either way. The "Custom time…" prompt
  (`ReminderPromptModal`) is unchanged - still always exact, since typing into that escape hatch is already
  a deliberate choice to bypass the quick-pick options.
- The modal's native date/time pickers' indicator icon (introduced in `fork.9` to make the two types look
  consistent) ended up pinned to the right for both - the user asked for the left instead, to match
  Obsidian's own placement for "date" elsewhere in the app. `EditTask.scss` now orders the icon before the
  digits for both types.

## 8.4.0+fork.9 — upstream base `8.4.0`

Two fixes/enhancements after testing `8.4.0+fork.8`:

- The edit modal's small native pickers next to the parsed-date preview (the quick-pick `<input
  type="date">`/`<input type="time">`) could look inconsistent with each other: Obsidian's own CSS polishes
  `type="date"` (it's used elsewhere in the app), but never touches `type="time"`, which fell back to the
  browser's raw, unstyled look — different border, background, font, and icon placement. `EditTask.scss` now
  styles `.tasks-modal-date-editor-picker` explicitly (border/background/font matching the rest of the
  modal's inputs, and the calendar/clock indicator icon pinned to the same side) so both types render as one
  consistent picker regardless of which date-like field they belong to.
- A relative reminder offset's label (e.g. "In 30 minutes (11:00)") now flags when the time shown is a
  rounded approximation rather than the exact offset: with rounding enabled (the default), it reads "In 30
  minutes (~11:00)"; with "No rounding" selected, the "~" is omitted since the time is then exact. Applies
  everywhere the shared `buildReminderSuggestions` list is shown — the rendered line's menu and the modal's
  autocomplete alike.

## 8.4.0+fork.8 — upstream base `8.4.0`

Bug fix, reported after testing `8.4.0+fork.7`: clicking a relative-offset item in the reminder menu (e.g.
"In 30 minutes (11:00)") applied the *raw, unrounded* offset (11:00's underlying 10:37) instead of the
rounded time the label promised. Introduced when `ReminderSuggestions.ts` was extracted: the menu re-parsed
the item's raw value (`'in 30 minutes'`) at click-time via `parseReminderTimeInput`, which re-resolves the
offset from "now" and discards the rounding that only existed in the label text. Fixed by having
`buildReminderSuggestions` carry the already-rounded date on each relative suggestion (`resolvedDate`), and
having the menu apply that directly instead of re-parsing.

Also added, per request: a "No rounding" option in Settings → Reminder → "Round relative offsets to",
alongside 15/30/60 minutes. Selecting it applies each relative offset's exact, unrounded time (so "In 30
minutes" always means exactly that), rather than snapping to a clean o'clock/half-past value.

## 8.4.0+fork.7 — upstream base `8.4.0`

Enhancement, after testing `8.4.0+fork.6`: the edit modal's Reminder field now offers the same presets and
relative offsets as the rendered line's click/right-click menu, as a native autocomplete list shown on
focus (an `<input list>`/`<datalist>` pair, so no custom dropdown widget or extra CSS is needed — same
"reuse the host app's/browser's own primitives" approach as the rest of this redesign). Picking one just
fills the field with its value (a plain time for a preset, the relative phrase itself for an offset), it
doesn't apply anything until Apply is pressed, same as typing that value would.

Both entry points are now built from one shared function
(`src/DateTime/ReminderSuggestions.ts::buildReminderSuggestions`), so "the same options" is guaranteed by
construction rather than by keeping two option-lists in sync by hand.

## 8.4.0+fork.6 — upstream base `8.4.0`

Fix/redesign, after testing `8.4.0+fork.5`'s reminder time entry: both the modal's plain time input and
the flatpickr click-editor were "really ugly" — this codebase has zero theming CSS for flatpickr, so it
never picked up Obsidian's look. Dropped flatpickr for reminder entirely in favour of native
Obsidian/browser primitives, which theme automatically:

- The right-click (and now also click) menu is built from **configurable** settings rather than a fixed
  list: `Preset reminder times` (default `09:00, 12:00, 15:00, 18:00`), `Relative reminder offsets`
  (default `30m, 1h, 2h, 4h`, shown as "In 30 minutes"/etc., computed fresh from the current time each time
  the menu opens), and a rounding increment (15/30/60 min, default 30) so a relative pick lands on a clean
  time.
- A relative pick that crosses midnight (e.g. "in 30 minutes" at 23:45) now shifts the task's anchor date
  (due, else scheduled, else start) forward by a day too, not just the time. A task with no anchor date at
  all is left without one — a relative reminder never creates a due date from nothing.
- The edit modal's Reminder field now matches every other date field's own look: a text input accepting
  either a clock time or a relative phrase, paired with a small native time-input preview.
- A new "Custom time…" menu item (a plain one-field dialog) replaces flatpickr as the exact-value escape
  hatch when none of the configured quick options fit.

## 8.4.0+fork.5 — upstream base `8.4.0`

Roadmap feature: **reminder field**. A distinct `⏰ HH:mm` signifier (paired with a task's due,
scheduled or start date - whichever is present, in that priority order) that
[obsidian-reminder](https://github.com/uphy/obsidian-reminder) already understands; the gap this closes is
purely that Tasks' own modal and rendering had no way to enter, see, or query it.

- **Modal**: a "Reminder" field in the task edit modal (access key `K` — none of R/E/M/I/N/D, the letters
  in "reminder", were free).
- **File format**: `⏰ 09:00` (emoji format) / `reminder:: 09:00` (Dataview format).
- **Rendered line**: shows as `⏰ 09:00`; click to open a time picker, right-click for a menu of preset
  times plus "Remove reminder" — the same interaction pattern as the other date fields, but its own
  time-only picker/menu rather than the calendar-date ones (a reminder has no date of its own).
- **Recurrence and completion**: the reminder time is carried forward unchanged across both — this was
  the exact bug flagged against the stale prior-art PR referenced in `CLAUDE.md`'s roadmap.
- **Queries**: `has reminder` / `no reminder`, `reminder before|after|on HH:mm`, `sort by reminder`,
  `group by reminder`. A task's reminder also contributes to `happens` searches (the other gap that PR
  left open), though since a reminder always shares its anchor date's day, this doesn't change which
  *day* a `happens` search matches.
- **Autocomplete**: typing in the description offers a `⏰`/`reminder::` suggestion, alongside the other
  simple fields.

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
