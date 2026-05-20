async function request(path) {
  const res = await fetch(path)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || res.statusText || 'Request failed')
  }
  return data
}

function withDatabase(database) {
  return new URLSearchParams({ database })
}

export function fetchDatabases() {
  return request('/api/databases')
}

export function fetchHealth(database) {
  return request(`/api/health?${withDatabase(database)}`)
}

const EMPTY_GROUPS = [
  { id: 'tables', label: 'Tables', items: [] },
  { id: 'procedures', label: 'Stored Procedures', items: [] },
  { id: 'views', label: 'Views', items: [] },
]

function normalizeGroups(data) {
  if (Array.isArray(data?.groups)) {
    return data.groups.map((group) => ({
      ...group,
      items: Array.isArray(group.items) ? group.items : [],
    }))
  }

  // Older API shape: flat { objects: [...] }
  if (Array.isArray(data?.objects)) {
    const tables = []
    const procedures = []
    const views = []
    const procTypes = new Set(['P', 'FN', 'IF', 'TF', 'TR'])

    for (const o of data.objects) {
      const type = String(o.type ?? '').trim()
      const item = {
        schema: o.schema,
        name: o.name,
        type,
        typeDesc: o.typeDesc,
      }
      if (type === 'U') tables.push(item)
      else if (type === 'V') views.push(item)
      else if (procTypes.has(type)) procedures.push(item)
    }

    return [
      { id: 'tables', label: 'Tables', items: tables },
      { id: 'procedures', label: 'Stored Procedures', items: procedures },
      { id: 'views', label: 'Views', items: views },
    ]
  }

  return EMPTY_GROUPS
}

export async function fetchObjects(database) {
  const data = await request(`/api/objects?${withDatabase(database)}`)
  return { ...data, groups: normalizeGroups(data) }
}

export function fetchObjectDefinition(database, schema, name) {
  const params = withDatabase(database)
  return request(
    `/api/objects/${encodeURIComponent(schema)}/${encodeURIComponent(name)}/definition?${params}`,
  )
}

export function fetchTableDefinition(database, schema, name) {
  const params = withDatabase(database)
  return request(
    `/api/tables/${encodeURIComponent(schema)}/${encodeURIComponent(name)}/definition?${params}`,
  )
}
