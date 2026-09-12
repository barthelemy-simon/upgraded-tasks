# upgraded-tasks

Personal fork of [obsidian-tasks-group/obsidian-tasks](https://github.com/obsidian-tasks-group/obsidian-tasks),
developed to add features the upstream maintainers won't take on. This folder lives directly inside the
test vault's plugin directory (`.obsidian/plugins/upgraded-tasks`), so a build in place is a build that's live.

- Fork: <https://github.com/barthelemy-simon/upgraded-tasks>
- `origin` = this fork, `upstream` = obsidian-tasks-group/obsidian-tasks (added so upstream releases can be
  merged in later — see "Staying in sync with upstream" below, this is a priority, not a someday-maybe).
- Plugin id was changed from `obsidian-tasks-plugin` to `upgraded-tasks` (see `manifest.json`) so it can't be
  confused with, or conflict with, a real Tasks install. It's enabled in this vault's
  `.obsidian/community-plugins.json` under that id.
- Test vault: `Test Task upgraded` (the folder two levels up from here).
- **`src/Config/SettingsTab.ts` has two parallel settings UIs that must both be updated for every setting**:
  `getSettingDefinitions()` (declarative, Obsidian 1.13.0+ — what virtually every real install actually
  renders) and `display()` (imperative, only used as a fallback on very old Obsidian). It's easy to edit only
  `display()`, see it build/lint/test cleanly, and still have the setting be completely invisible in a normal
  install — there's no error, the setting simply never renders. Always add/change the same setting in both
  places (there's a doc comment on the `SettingsTab` class saying so).

## Staying in sync with upstream

**Being able to pull in upstream releases is a priority for this fork, not an afterthought.** The whole
point of forking rather than writing a standalone plugin is to keep getting obsidian-tasks' upstream bug
fixes and new features for free, and to only carry the small set of fork-specific additions (reminder field,
postpone button, tabular view) on top of that. If a sync ever becomes too painful to do because the fork has
drifted too far from upstream, that's a signal to shrink the fork's footprint (push logic upstream, or make
the local change smaller/more isolated), not a reason to stop syncing.

**How a sync actually happens:**

```bash
git fetch upstream
git merge upstream/main        # merge, not rebase
```

- **Merge, don't rebase.** `main`'s history here is already merge-commit-based (PRs from `origin` are
  merged in, not squashed or rebased — see the commit log), so merging upstream in keeps that consistent and
  never rewrites commits already pushed to `origin`. (This is the same reasoning behind not rebasing the
  stale PR #2750 referenced below — rebasing history that's already shared is the wrong tool here.)
- **A merge takes everything from upstream and only forces a decision on what actually conflicts.** Any file
  upstream touched that this fork hasn't will merge cleanly with no action needed. Conflicts only come up on
  the files this fork has modified — expect them mainly in:
  - `manifest.json` / `package.json` — `id`, `name`, `author*`, `fundingUrl`, `helpUrl`, `description` are
    fork-specific and always win over upstream's values on conflict; take upstream's side for everything else
    in those files (e.g. a `minAppVersion` bump, dependency version bumps).
  - Whichever files the roadmap features below end up touching (`TaskLineRenderer.ts`, `Task.ts`,
    `EditTask.svelte`, `Recurrence.ts`, etc.) — resolve by combining both sides' logic, never by picking one
    side wholesale.
  - This `CLAUDE.md`.
- **Never resolve a conflict by discarding a fork-specific change.** If making a conflict go away would mean
  losing an already-implemented fork feature, that means the merge needs manual reconciliation of both sides'
  logic — not a `--theirs`/`--ours` shortcut.
- After a clean merge: `yarn build`, reload the plugin in Obsidian, and confirm the fork-specific features
  still work before committing/pushing the merge commit.
- Bump the version per the scheme below as part of the same sync.

## Versioning

Version string format: `<upstream-version>+fork.<N>` (e.g. `8.4.0+fork.1`, `8.4.0+fork.2`, then
`8.5.0+fork.1` after the next upstream sync). Used in both `manifest.json` and `package.json`.

- This is semver **build metadata** (the `+` suffix), not a pre-release suffix. A pre-release (`-` suffix,
  e.g. `8.4.0-0.0.1`) sorts *lower* than the plain version in real semver — which would misdescribe this fork
  as an unfinished beta of vanilla 8.4.0, when it's actually 8.4.0 plus additional features. Build metadata
  doesn't affect precedence and reads correctly: "upstream 8.4.0, fork build 1."
- `N` increments for a fork-only change (no new upstream commits pulled in) and resets to `1` the next time
  upstream is synced to a new base version.
- Keep a `CHANGELOG.md` mapping each fork version to the upstream tag/commit it's synced to and the
  fork-specific changes on top — the version string alone doesn't carry the "what changed" detail.

## Roadmap (see conversation history for full research)

1. ~~**Reminder field in the task modal.**~~ **Done**, full scope (on branch `feature/reminder-field`,
   not yet merged — see CHANGELOG.md's `8.4.0+fork.5` entry for the exact feature list). Reimplemented from
   scratch against current `main`, not from the stale prior-art PR #2750 the roadmap used to point to
   (draft, last synced May 2024, ~6,000 commits behind `main` at the time — still worth reading as design
   reference if this area is revisited, but do not try to rebase it). Its reviewer's two flagged edge cases
   are both explicitly fixed/covered: reminder time now survives completion/recurrence (Task.ts's generic
   spread-recovery mechanism carries it forward automatically, the same way priority/tags already are, so
   there was no special-case code needed — it just had to not be reset), and `happens` now includes it.
   The access-key clash is avoided too: `K`, not `C` (Created Date's).

   **Important correction, found by testing against the actual Reminder plugin (`8.4.0+fork.12`):** the
   original roadmap research's assumption that Reminder "already understands a distinct `⏰ HH:MM` signifier
   ... no changes needed on the Reminder side" was **wrong** — reverse-engineering Reminder's own bundled
   `main.js` (its "Tasks plugin format" reader) showed it needs a *full date* (optionally with a time) under
   `⏰`, exactly like it does for `📅`/`⏳`/`🛫`; a bare `HH:mm` fails to parse and the *entire line* is then
   silently not recognised as a reminder at all (Reminder tries `⏰` first, before falling back to the other
   three, per its own "Fall back to due, scheduled, or start date" setting). Fixed by writing `⏰ YYYY-MM-DD
   HH:mm` (the anchor date plus the time) instead — see `symbolAndReminderTimeValue` in
   `DefaultTaskSerializer.ts` — while still reading a bare `HH:mm` for backward compatibility with tasks an
   earlier fork version already wrote. The *rendered* line still shows just the bare time (the date's
   already visible via the anchor field right beside it) — see `TaskLineRenderer.ts`'s override of that one
   component's rendered text. This also meant every reminder-setting path now guarantees an anchor date
   exists (creating today's `scheduledDate` if the task has none at all) — see `SetReminderTime`'s doc
   comment in `ReminderInstructions.ts` — since a reminder time with nowhere to attach it is exactly the
   state Reminder can't recognise.
2. ~~**Postpone (⏩) to next business day.**~~ **Done** (merged into `main`). Behind a setting
   (`postponeSkipWeekends`, default off) in `src/Config/Settings.ts`/`SettingsTab.ts` — remember this file has
   **two** parallel settings UIs that both need updating (see the note above). The actual date math is
   `TasksDate.postpone()`/`src/DateTime/Postponer.ts`, not `TaskLineRenderer.ts` (that file only displays
   dates; the button/menu logic lives in `HtmlQueryResultsRenderer.ts` and `ui/Menus/PostponeMenu.ts`). Once
   enabled, day-based increments (button and "N days" menu items) count **business days**, not calendar days
   rolled off a weekend at the end — otherwise different amounts collapse onto the same following Monday.
   Week/month increments just roll their single final result. Related upstream issues: #3379, #3818, #2674,
   #3502.
3. **Cross-project tabular view.** A new renderer mode that lays out the *already-computed* nested
   `TaskGroups` tree (bucket → project → tasks) as a table instead of nested lists — purely additive, doesn't
   touch filtering/sorting/grouping, so low conflict risk against upstream. (Do not confuse with
   [#3852](https://github.com/obsidian-tasks-group/obsidian-tasks/issues/3852), which was a *different*,
   rejected ask about per-task computed columns.)

   Layout: two columns, `Project` | `Tasks`. Outer grouping is the due-status bucket (`Overdue` / `Due
   today` / `Due this week` / `Due later`), rendered as a full-width, color-coded header row — bucket order
   is fixed by urgency, overriding Tasks' normal alphabetical-by-group-name sort. Inner grouping is project:
   one row per project that has at least one task in that bucket (no empty rows). A row's right-hand cell
   stacks every task for that (bucket, project) pair as multiple lines — tasks are not exploded into one row
   each. Sort order: buckets by fixed urgency order, projects within a bucket alphabetically (Tasks' existing
   `group by` sort), tasks within a cell by due date (soonest first, Tasks' existing default).

   ```text
   ┌───────────────────────────────────────────┐
   │ Overdue                                    │  ← bucket header, full width
   ├───────────┬─────────────────────────────────┤
   │ Project A │ Task A.1                        │  ← one row per project-in-bucket
   │           │ Task A.2                        │     (multiple tasks stack in the cell)
   ├───────────┴─────────────────────────────────┤
   │ Due today                                   │
   ├───────────┬─────────────────────────────────┤
   │ Project A │ Task A.3                        │
   │ Project B │ Task B.1                        │
   │ Project C │ Task C.1                        │
   ├───────────┴─────────────────────────────────┤
   │ Due this week                                │
   ├───────────┬─────────────────────────────────┤
   │ Project B │ Task B.2                        │
   │           │ Task B.3                        │
   │           │ Task B.4                        │
   ├───────────┴─────────────────────────────────┤
   │ Due later                                    │
   ├───────────┬─────────────────────────────────┤
   │ Project A │ Task A.4                        │
   │ Project C │ Task C.2                        │
   │           │ Task C.3                        │
   └───────────┴─────────────────────────────────┘
   ```

## Build

Uses **Yarn** (there's a `yarn.lock`, no `package-lock.json` — `npm install` will fail with an ERESOLVE error
on `esbuild-sass-plugin`'s peer dependency).

```bash
yarn install --ignore-engines --ignore-scripts   # see note below
yarn build        # production build -> main.js, styles.css (outdir is '.', i.e. this folder)
yarn dev          # esbuild watch mode, same output location
```

`--ignore-engines` is needed because `i18next-parser` pins to Node 18/20/22 and this machine runs Node 24.
`--ignore-scripts` works around a broken Windows postinstall in the `approvals` test dependency
(`spawn EINVAL`) — it's only used by the test suite, not the build, so this is safe for day-to-day plugin
dev. If you need to run `yarn test`, you may need to install `approvals` separately or patch around its
postinstall.

Since this folder *is* `.obsidian/plugins/upgraded-tasks`, there's no deploy step needed for manual testing —
building here is building live. (The repo's own `scripts/Test-TasksInLocalObsidian.mjs` copies build output
into `<vault>/.obsidian/plugins/obsidian-tasks-plugin`, which is a *different* folder/id than this one — not
needed for this setup, but useful if you ever want a separate side-by-side vault copy.)

Reload the plugin in Obsidian after building: Settings → Community plugins → toggle "Tasks (Upgraded Fork)"
off/on (or restart Obsidian) to pick up a fresh `main.js`.
