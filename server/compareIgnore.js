// Objects that live only on Prod and should NOT be flagged as "missing from Dev"
// during a compare. Edit this list by hand — it is intentionally code, not UI.
//
// Match is case-insensitive on "schema.name". Two forms are supported:
//   'dbo.AuditLog'   exact object
//   'staging.*'      every object in a schema
//
// This only suppresses "only in Prod" results. Objects that exist in both
// servers but whose content differs are always reported.

export const IGNORE = [
  // 'dbo.AuditLog',
  // 'staging.*',
]

export function isIgnored(key) {
  const lower = key.toLowerCase()
  return IGNORE.some((raw) => {
    const pattern = raw.trim().toLowerCase()
    if (!pattern) return false
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2)
      return lower === prefix || lower.startsWith(`${prefix}.`)
    }
    return lower === pattern
  })
}
