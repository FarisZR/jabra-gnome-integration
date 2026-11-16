# Untangling decisions

Inventory made before implementation. The repository began at 60c5bbe, with one
commit and no tests; history cannot establish which files usually change together.
The user selected both Comments and Tests cleanup and confirmed GNOME Shell 51.

## Own asynchronous work within one start/stop session

- Hidden link: headset.js refresh serialization, cancellation and timeout fields
  belong to a session, but stop/start shares them with still-running old requests.
  An old completion can prevent the new monitor from refreshing.
- Hidden link: jabridge.js old subscription cleanup can clear a new run's heartbeat.
- Special case: heartbeat errors are silently discarded; failed writes must end
  that subscription and enter its normal reconnect path.
- Hidden link: media.js D-Bus work outlives extension disable; ListNames has an
  unlimited timeout. Make the extension's cancellable own media operations too.
- Hidden link: refresh errors can prevent future observation scheduling. Schedule
  in a session-owned finally block.

## Separate headset decisions from observation and transport

- Headset selection and disconnect transitions are mixed with GIO scheduling.
  Extract pure headset policy; retain the small existing RPC boundary rather than
  introducing a shallow facade for two methods.
- Hidden link: polling cadence is computed from the connection retry deadline;
  changing reconnect policy changes observation latency and causes empty-list
  polling every second. Poll every five seconds; throttle connect independently.
- Special cases to retain: unknown service state/empty lists must not pause media;
  bt.connect must only run when no remembered headset is connected because it
  disconnects other headsets. Name matching selects a remembered device, with
  the first device as fallback. These are requirements of jabridge.

## Keep Shell input and presentation in the indicator

- Needless link: extension.js mixes actor construction/input compatibility with
  extension lifecycle and output/media policy. Move indicator into its own module.
- Special case to retain: GNOME 48 needs legacy input signals, while modern Shell
  uses ClickGesture/KeyController. Keep feature detection together at this boundary.
- Surplus: connected style class has no CSS rule; remove that empty state coupling.
- Compatibility: metadata omits 51, so the installed extension is OUT OF DATE on
  the host's Shell 51.1. Validate against the actual 51.1 runtime.

## Build one payload for every installation path

- Hidden links: install.sh repeats UUID and source-module inventory; newly added
  modules would be missing from installations. Derive UUID from metadata and
  package all runtime JS together, excluding development directories.
- Special case: installation removes the existing tree before validating the new
  payload. Stage/compile/validate first and replace with rollback on failure.
- Hidden links: new Homebrew/CI/local package logic must not maintain separate
  payload lists. Produce ZIP and named-directory tar from one staging tree.
- Requirement: retain jabridge release checksum verification, user setup and weekly
  updates for the self-managed binary. Package-manager binaries do not self-update.
- Requirement: rolling main builds must publish only validated immutable commit
  assets; delayed jobs must not roll back the tap's latest version.

## Remaining intentional boundaries and special cases

- Shell output-name matching uses Jabra names because jabridge does not expose a
  PipeWire sink identity. Remember output before disconnect: PipeWire can switch
  outputs before the headset notification arrives.
- Per-player D-Bus errors are independent: one player exiting must not prevent
  others from pausing. Log errors except lifecycle cancellation.
- Socket EOF, malformed replies and service restarts require reconnecting with a
  five-second backoff. Heartbeats keep the subscription alive per jabridge IPC.
- Local setup remains separate from package installation: installing an extension
  artifact cannot authorize USB-device permissions or configure jabridge itself.

## Verification and review

- Independent review found the session lifecycle fix sound and no further
  structural issues worth fixing after removing the duplicated icon constant.
- GJS socket tests cover headset selection, explicit disconnect vs service loss,
  non-displacement, retry backoff, cancelled requests and immediate restart.
- Isolated MPRIS tests cover pausing only playing players and cancellation.
- Package checks compare ZIP/tar bytes, runtime imports, schemas and commit identity.
- A headless GNOME Shell 51.1 session loaded, disabled and re-enabled the packaged
  extension successfully. GNOME 48–50 compatibility paths remain; they were not
  exercised on those Shell versions in this environment.
- Physical headset disconnect/media playback and lock-screen behavior still need
  human hardware validation; automated tests do not claim to prove them.
