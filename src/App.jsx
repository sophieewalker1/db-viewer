import { useCallback, useEffect, useState } from 'react'
import {
  fetchDatabases,
  fetchHealth,
  fetchObjectDefinition,
  fetchObjects,
  fetchTableDefinition,
} from './api'
import './App.css'

function App() {
  const [databases, setDatabases] = useState([])
  const [database, setDatabase] = useState('')
  const [status, setStatus] = useState({ loading: true, ok: null, error: null })
  const [groups, setGroups] = useState([])
  const [objectsError, setObjectsError] = useState(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [definition, setDefinition] = useState({
    loading: false,
    text: null,
    typeDesc: null,
    encrypted: false,
    error: null,
  })

  const loadDatabase = useCallback(async (db, cancelled = () => false) => {
    setStatus({ loading: true, ok: null, error: null })
    setGroups([])
    setObjectsError(null)
    setSelected(null)
    setDefinition({ loading: false, text: null, typeDesc: null, encrypted: false, error: null })

    try {
      const health = await fetchHealth(db)
      if (cancelled()) return
      setStatus({ loading: false, ok: health.ok, error: null })

      try {
        const { groups: list } = await fetchObjects(db)
        if (cancelled()) return
        setGroups(Array.isArray(list) ? list : [])
      } catch (err) {
        if (cancelled()) return
        setObjectsError(err.message)
      }
    } catch (err) {
      if (cancelled()) return
      setStatus({ loading: false, ok: false, error: err.message })
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    fetchDatabases()
      .then(({ databases: dbs }) => {
        if (cancelled) return
        setDatabases(dbs)
        setDatabase(dbs[0] ?? '')
      })
      .catch((err) => {
        if (cancelled) return
        setStatus({ loading: false, ok: false, error: err.message })
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!database) return
    let cancelled = false
    loadDatabase(database, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [database, loadDatabase])

  useEffect(() => {
    if (!selected || !database) return

    let cancelled = false
    setDefinition({ loading: true, text: null, typeDesc: null, encrypted: false, error: null })

    const fetchDef =
      selected.groupId === 'tables'
        ? fetchTableDefinition(database, selected.schema, selected.name)
        : fetchObjectDefinition(database, selected.schema, selected.name)

    fetchDef
      .then((data) => {
        if (cancelled) return
        setDefinition({
          loading: false,
          text: data.definition,
          typeDesc: data.typeDesc,
          encrypted: data.encrypted,
          error: null,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setDefinition({
          loading: false,
          text: null,
          typeDesc: null,
          encrypted: false,
          error: err.message,
        })
      })

    return () => {
      cancelled = true
    }
  }, [selected, database])

  const fullName = (o) => `${o.schema}.${o.name}`
  const q = filter.trim().toLowerCase()

  const safeGroups = Array.isArray(groups) ? groups : []

  const filteredGroups = safeGroups
    .map((group) => {
      const items = Array.isArray(group?.items) ? group.items : []
      return {
        ...group,
        items: q
          ? items.filter(
              (o) =>
                fullName(o).toLowerCase().includes(q) ||
                (o.typeDesc && o.typeDesc.toLowerCase().includes(q)),
            )
          : items,
      }
    })
    .filter((group) => group.items.length > 0)

  const totalCount = safeGroups.reduce(
    (n, g) => n + (Array.isArray(g?.items) ? g.items.length : 0),
    0,
  )

  return (
    <div className="viewer">
      <header className="viewer-header">
        <h1>DB Viewer</h1>
        <div className="header-controls">
          {databases.length > 0 && (
            <label className="db-select">
              Database
              <select
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                disabled={status.loading}
              >
                {databases.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="status">
            {status.loading && 'Connecting…'}
            {!status.loading && status.ok && (
              <>
                Connected to <strong>{database}</strong>
              </>
            )}
            {!status.loading && !status.ok && (
              <span className="error">Connection failed: {status.error}</span>
            )}
          </p>
        </div>
      </header>

      <div className="viewer-body">
        <aside className="sidebar" aria-label="Object list">
          <h2>Schema</h2>
          <p className="sidebar-hint">Tables, procedures, and views</p>
          <input
            type="search"
            className="filter-input"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {objectsError && <p className="error">{objectsError}</p>}
          {!objectsError && totalCount === 0 && !status.loading && status.ok && (
            <p className="muted">No objects found.</p>
          )}
          <div className="sidebar-scroll">
            {filteredGroups.map((group) => (
              <section key={group.id} className="object-group">
                <h3 className="group-header">
                  {group.label}
                  <span className="group-count">{group.items.length}</span>
                </h3>
                <ul className="object-list">
                  {group.items.map((o) => (
                    <li key={`${group.id}-${o.type}-${fullName(o)}`}>
                      <button
                        type="button"
                        className={
                          selected?.groupId === group.id &&
                          selected?.schema === o.schema &&
                          selected?.name === o.name
                            ? 'active'
                            : ''
                        }
                        onClick={() =>
                          setSelected({
                            groupId: group.id,
                            schema: o.schema,
                            name: o.name,
                            type: o.type,
                          })
                        }
                      >
                        <span className="obj-name">{fullName(o)}</span>
                        {group.id === 'procedures' && o.type !== 'P' && (
                          <span className="obj-type">{shortType(o.typeDesc)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </aside>

        <main className="main">
          {!selected && (
            <p className="muted">
              Select a table, stored procedure, or view to view its definition.
            </p>
          )}
          {selected && (
            <>
              <h2>
                {selected.schema}.{selected.name}
                {definition.typeDesc && (
                  <span className="type-badge">{definition.typeDesc}</span>
                )}
              </h2>
              {definition.loading && <p className="muted">Loading definition…</p>}
              {definition.error && <p className="error">{definition.error}</p>}
              {definition.encrypted && !definition.text && (
                <p className="muted">
                  Definition is encrypted or not available (sp_helptext cannot show it).
                </p>
              )}
              {!definition.loading && !definition.error && definition.text && (
                <pre className="definition">
                  <code>{definition.text}</code>
                </pre>
              )}
              {!definition.loading &&
                !definition.error &&
                !definition.text &&
                !definition.encrypted && (
                  <p className="muted">No definition text returned.</p>
                )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function shortType(typeDesc) {
  return typeDesc
    .replace('SQL_', '')
    .replace(/_/g, ' ')
    .toLowerCase()
}

export default App
