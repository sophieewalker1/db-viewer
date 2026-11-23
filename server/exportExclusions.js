import { readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// Objects unchecked in the Export tab. Keyed by database name (not server),
// so the same choices apply to both Dev and Prod.
//
// Shape:
//   {
//     "excludedDatabases": ["SomeDb"],
//     "excludedObjects": { "SomeDb": ["dbo.AuditLog", "dbo.usp_Old"] }
//   }

const __dirname = dirname(fileURLToPath(import.meta.url))
const FILE = join(__dirname, 'exportExclusions.json')

function empty() {
  return { excludedDatabases: [], excludedObjects: {} }
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((v) => typeof v === 'string' && v))].sort()
    : []
}

export function sanitizeExclusions(raw) {
  const result = empty()
  if (!raw || typeof raw !== 'object') return result

  result.excludedDatabases = stringList(raw.excludedDatabases)

  if (raw.excludedObjects && typeof raw.excludedObjects === 'object') {
    for (const [db, list] of Object.entries(raw.excludedObjects)) {
      const clean = stringList(list)
      if (clean.length) result.excludedObjects[db] = clean
    }
  }
  return result
}

export async function loadExclusions() {
  try {
    return sanitizeExclusions(JSON.parse(await readFile(FILE, 'utf8')))
  } catch (err) {
    if (err.code === 'ENOENT') return empty()
    throw err
  }
}

export async function saveExclusions(raw) {
  const clean = sanitizeExclusions(raw)
  await writeFile(FILE, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  return clean
}
