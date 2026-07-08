async function request(path) {
  const res = await fetch(path)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || res.statusText || 'Request failed')
  }
  return data
}

function params(obj) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(obj)) {
    if (value != null && value !== '') search.set(key, value)
  }
  return search
}

export function fetchServers() {
  return request('/api/servers')
}

export function fetchDatabases() {
  return request('/api/databases')
}

export function fetchHealth(database, server) {
  return request(`/api/health?${params({ database, server })}`)
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

export async function fetchObjects(database, server) {
  const data = await request(`/api/objects?${params({ database, server })}`)
  return { ...data, groups: normalizeGroups(data) }
}

export function fetchCompare(database) {
  return request(`/api/compare?${params({ database })}`)
}

export function fetchObjectDefinition(database, schema, name, server) {
  return request(
    `/api/objects/${encodeURIComponent(schema)}/${encodeURIComponent(name)}/definition?${params({ database, server })}`,
  )
}

export function fetchTableDefinition(database, schema, name, server) {
  return request(
    `/api/tables/${encodeURIComponent(schema)}/${encodeURIComponent(name)}/definition?${params({ database, server })}`,
  )
}

export function fetchDefinitionFor(database, item, server) {
  return item.groupId === 'tables'
    ? fetchTableDefinition(database, item.schema, item.name, server)
    : fetchObjectDefinition(database, item.schema, item.name, server)
}
