// Map an X/Twitter handle to a valid live.slop.computer room slug.
// Mirrors the on-chain SlopComputer contract rule: ^[a-z0-9-]{1,64}$ with no
// leading/trailing hyphen. Underscores (and any other invalid char) -> hyphen.
// (We deliberately do NOT loosen this — the mainnet contract enforces it and
// rejects anything else with SlugInvalid(). See SLOP-WORKFLOW.md.)
export function handleToSlug(handle) {
  return String(handle)
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-') // _ and other invalid chars -> hyphen
    .replace(/-+/g, '-')          // collapse runs
    .replace(/^-+|-+$/g, '')      // contract: no leading/trailing hyphen
    .slice(0, 64);
}
