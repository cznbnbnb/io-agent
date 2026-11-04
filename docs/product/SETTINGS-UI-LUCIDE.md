# Settings and shared icons

This change retains iO Agent's dark green / teal palette and uses the same native
presentation for the settings landing page and its secondary pages.

## Presentation

- Background `#0D100F`, surface `#1C2420`, border `#303B35`, text `#F0F3F1`,
  secondary text `#A2AFA5`, accent `#02A97B`.
- System sans-serif; page titles 26 sp, status headings 18 sp, rows 15 sp,
  secondary details 12–13 sp. Standard settings rows remain at least 56 dp tall.
- Settings separates connections/workspace, materials/reminders, and additional
  tools. The glasses status is the only prominent status panel.
- Matching secondary pages: glasses connection, phones and migration, computer
  connections, connection details/registration diagnostics, defaults, pairing
  scan/paste/review, reminders, sync details/registration, export location,
  original audio/export, account/devices, about, tools index and diagnostics index.
- Existing extension tools retain their own content pages. Device/sync/permission
  behavior is unchanged by presentation work.
- Long paths stay secondary; IDs and credential expiry live in registration
  diagnostics. The main state distinguishes executable, not-ready and offline.
- Primary buttons use existing teal; dangerous removal stays a quiet action with
  explicit confirmation. System Back cancels that confirmation without removal.

## Imported artwork

The shared bottom navigation, page navigation, materials actions, refresh control
and settings icons use actual Lucide assets, not locally imitated paths.

See `rebuild/android-app/vendor/lucide/README.md`: 43 official icons pinned to
Lucide 0.468.0, with upstream SVGs, reproducible 96 px transparent PNGs, full ISC
and Feather MIT licenses, and SHA-256 manifest. PNG payload is 77,205 bytes.
Android caches each decoded bitmap once. Refresh rotates only while a visible
page is reading and stops when detached/hidden; disabled system animations are
respected. Checkbox/switch geometry and data diagrams are still native controls.

## Local offline-session removal

The existing service has no session-deletion endpoint. The phone therefore
explicitly says **remove this phone's session entry**, retaining mailbox files,
computer files, pairing and server registration.

- Long-press an offline, not-ready, expired or locally paused entry, or open its
  details and use Remove. An executable live entry must first be paused.
- Unsent answers/commands and unanswered questions block removal with a clear
  instruction to finish them first.
- Removing the shared default first clears it through the existing revisioned
  default API. Failure does not silently substitute a different destination.
- Target pickers and the default-workspace list also filter the same current-account
  removal markers; this does not modify the server directory.
- A local removal marker prevents normal discovery and token renewal from
  restoring the entry. Explicit re-registration/target selection or Restore
  removed sessions can bring it back. Restore only applies to matching entries in
  the current account directory, reports its actual count, and leaves other
  accounts and existing registrations intact. Legacy imported sessions require
  explicitly re-importing their connection file.
- Removing the last local registration clears its old rollback credential. No
  mailbox directory is deleted.

## Offline verification and remaining device acceptance

Passed: directory 126 checks, controls 98, context/mailbox 68, status 41;
TaskSettings removal 28 real AES/GCM checks (Android key/prefs boundary fixtures);
43 source/render/license hashes; deterministic icon reproduction; APK public
asset selection; isolated Android 36 / Java 8 compilation.

The phone was unavailable at the user's request. Actual text scaling/layout,
long-press and Back gestures, visual refresh motion and an installed APK's
settings navigation still require the next device verification. No phone or
glasses actions were performed for this UI change.
