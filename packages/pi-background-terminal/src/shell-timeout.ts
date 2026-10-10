/**
 * Default and hard cap for the built-in shell tools' timeout parameter, in seconds.
 * Kept here because background_run's lifetime guard reads it (BYTE-7): "was a usable
 * timeout passed?" must mean the same thing on every shell surface this package owns.
 *
 * The foreground inject-and-clamp hook that also used to live in this package moved to
 * the separate small-extensions/pi-bash-timeout extension (BYTE-10, GitHub #3): installed
 * source must be able to contain no foreground-timeout hook at all, which a runtime
 * switch inside this package cannot offer. This constant and the guard below are pure
 * helpers — no hook code remains here.
 */
export const SHELL_TIMEOUT_SECONDS = 300;

/** A usable timeout: finite, positive, a real number. Anything else counts as absent.
 * Note: `0` is treated as absent on purpose — Node convention reads it as "infinite",
 * and an unbounded foreground command is exactly what an unbounded background task
 * would be, too. The small-extensions/pi-bash-timeout extension carries its own copy of
 * this guard (packages and extensions in this repo never depend on each other) so both
 * surfaces keep answering "was a timeout actually passed?" with the same semantics. */
export function isUsableTimeout(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
