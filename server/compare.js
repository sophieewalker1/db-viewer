import { isIgnored } from './compareIgnore.js'

const PROC_TYPES = new Set(['P', 'FN', 'IF', 'TF', 'TR'])

function groupIdForType(type) {
  if (type === 'U') return 'tables'
  if (type === 'V') return 'views'
  if (PROC_TYPES.has(type)) return 'procedures'
  return 'other'
}

// Strip comments and collapse all whitespace (newlines, tabs, indent)
// so only real SQL token differences count.
function normalize(text) {
  if (!text) return ''
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const comment = line.indexOf('--')
      if (comment >= 0) line = line.slice(0, comment)
      return line
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Pulls every comparable object out of one database:
//  - code objects (views / procs / functions / triggers) by their source text
//  - tables by a signature built from their column list
export async function getComparable(pool) {
  const map = new Map()

  const code = await pool.request().query(`
    SELECT
      s.name AS [schema],
      o.name AS [name],
      RTRIM(o.type) AS [type],
      o.type_desc AS [typeDesc],
      m.definition AS [definition]
    FROM sys.objects o
    INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
    LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
    WHERE o.type IN ('P', 'V', 'FN', 'IF', 'TF', 'TR')
      AND o.is_ms_shipped = 0
  `)

  for (const row of code.recordset) {
    const type = String(row.type ?? '').trim()
    const key = `${row.schema}.${row.name}`.toLowerCase()
    map.set(key, {
      schema: row.schema,
      name: row.name,
      type,
      typeDesc: row.typeDesc,
      groupId: groupIdForType(type),
      content: normalize(row.definition),
    })
  }

  const cols = await pool.request().query(`
    SELECT
      s.name AS [schema],
      t.name AS [name],
      c.column_id,
      c.name AS [col],
      ty.name AS [typeName],
      c.max_length,
      c.precision,
      c.scale,
      c.is_nullable,
      c.is_identity
    FROM sys.tables t
    INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
    INNER JOIN sys.columns c ON c.object_id = t.object_id
    INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name, c.column_id
  `)

  const tableSigs = new Map()
  for (const row of cols.recordset) {
    const key = `${row.schema}.${row.name}`.toLowerCase()
    const line = [
      row.col,
      row.typeName,
      row.max_length,
      row.precision,
      row.scale,
      row.is_nullable,
      row.is_identity,
    ].join('|')

    if (!tableSigs.has(key)) {
      tableSigs.set(key, { schema: row.schema, name: row.name, lines: [] })
    }
    tableSigs.get(key).lines.push(line)
  }

  for (const [key, { schema, name, lines }] of tableSigs) {
    map.set(key, {
      schema,
      name,
      type: 'U',
      typeDesc: 'USER_TABLE',
      groupId: 'tables',
      content: lines.join('\n'),
    })
  }

  return map
}

function meta(item) {
  return {
    schema: item.schema,
    name: item.name,
    type: item.type,
    typeDesc: item.typeDesc,
    groupId: item.groupId,
  }
}

export function buildComparison(devMap, prodMap) {
  const different = []
  const onlyDev = []
  const onlyProd = []
  const ignored = []
  const same = []

  const keys = [...new Set([...devMap.keys(), ...prodMap.keys()])].sort()

  for (const key of keys) {
    const dev = devMap.get(key)
    const prod = prodMap.get(key)

    if (dev && prod) {
      if (dev.content === prod.content) same.push(meta(dev))
      else different.push(meta(dev))
    } else if (dev && !prod) {
      onlyDev.push(meta(dev))
    } else if (!dev && prod) {
      if (isIgnored(key)) ignored.push(meta(prod))
      else onlyProd.push(meta(prod))
    }
  }

  return [
    { id: 'different', label: 'Different', items: different },
    { id: 'onlyDev', label: 'Only in Dev', items: onlyDev },
    { id: 'onlyProd', label: 'Only in Prod', items: onlyProd },
    { id: 'ignored', label: 'Ignored (Prod only)', items: ignored },
    { id: 'same', label: 'Identical', items: same },
  ]
}
