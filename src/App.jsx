import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchCompare,
  fetchDatabases,
  fetchDefinitionFor,
  fetchHealth,
  fetchObjectDefinition,
  fetchObjects,
  fetchServers,
  fetchTableDefinition,
} from './api'
import { diffColumns } from './diff'
import './App.css'

function App() {
  const [servers, setServers] = useState([])
  const [view, setView] = useState('')
  const [databases, setDatabases] = useState([])
  const [database, setDatabase] = useState('')

  const isCompare = view === 'compare'
  const activeServer = isCompare ? null : view

  useEffect(() => {
    let cancelled = false

    Promise.all([fetchServers(), fetchDatabases()])
      .then(([serverData, dbData]) => {
        if (cancelled) return
        const srvs = serverData.servers ?? []
        setServers(srvs)
        setView(srvs[0]?.id ?? '')
        const dbs = dbData.databases ?? []
        setDatabases(dbs)
        setDatabase(dbs[0] ?? '')
      })
      .catch(() => {
        if (cancelled) return
      })

    return () => {
      cancelled = true
    }
  }, [])

  const canCompare = servers.length >= 2

  return (
    <div className="viewer">
      <header className="viewer-header">
        <h1>DB Viewer</h1>
        <div className="mode-tabs" role="tablist" aria-label="Server">
          {servers.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={view === s.id}
              className={view === s.id ? 'active' : ''}
              onClick={() => setView(s.id)}
            >
              {s.label}
            </button>
          ))}
          {canCompare && (
            <button
              type="button"
              role="tab"
              aria-selected={isCompare}
              className={isCompare ? 'active' : ''}
              onClick={() => setView('compare')}
            >
              Compare
            </button>
          )}
        </div>
        <div className="header-controls">
          {databases.length > 0 && (
            <label className="db-select">
              Database
              <select value={database} onChange={(e) => setDatabase(e.target.value)}>
                {databases.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {isCompare ? (
        <CompareView database={database} />
      ) : (
        <BrowseView server={activeServer} database={database} />
      )}
    </div>
  )
}

function BrowseView({ server, database }) {
  const [status, setStatus] = useState({ loading: true, ok: null, error: null })
  const [groups, setGroups] = useState([])
  const [objectsError, setObjectsError] = useState(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [connectedDb, setConnectedDb] = useState(null)
  const [definition, setDefinition] = useState({
    loading: false,
    text: null,
    typeDesc: null,
    encrypted: false,
    error: null,
  })
  const loadIdRef = useRef(0)

  const loadDatabase = useCallback(async (srv, db, cancelled = () => false) => {
    const loadId = ++loadIdRef.current

    setStatus({ loading: true, ok: null, error: null })
    setConnectedDb(null)
    setGroups([])
    setObjectsError(null)
    setSelected(null)
    setDefinition({ loading: false, text: null, typeDesc: null, encrypted: false, error: null })

    const stale = () => cancelled() || loadId !== loadIdRef.current

    try {
      const health = await fetchHealth(db, srv)
      if (stale()) return
      setStatus({ loading: false, ok: health.ok, error: null })
      setConnectedDb(health.database ?? db)

      try {
        const { groups: list } = await fetchObjects(db, srv)
        if (stale()) return
        setGroups(Array.isArray(list) ? list : [])
      } catch (err) {
        if (stale()) return
        setObjectsError(err.message)
      }
    } catch (err) {
      if (stale()) return
      setStatus({ loading: false, ok: false, error: err.message })
    }
  }, [])

  useEffect(() => {
    if (!server || !database) return
    let cancelled = false
    loadDatabase(server, database, () => cancelled)
    return () => {
      cancelled = true
    }
  }, [server, database, loadDatabase])

  useEffect(() => {
    if (!selected || !database || !server) return

    let cancelled = false
    setDefinition({ loading: true, text: null, typeDesc: null, encrypted: false, error: null })

    const fetchDef =
      selected.groupId === 'tables'
        ? fetchTableDefinition(database, selected.schema, selected.name, server)
        : fetchObjectDefinition(database, selected.schema, selected.name, server)

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
  }, [selected, database, server])

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
    <>
      <p className="status">
        {status.loading && 'Connecting…'}
        {!status.loading && status.ok && (
          <>
            Connected to <strong>{connectedDb ?? database}</strong>
          </>
        )}
        {!status.loading && !status.ok && (
          <span className="error">Connection failed: {status.error}</span>
        )}
      </p>

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
    </>
  )
}

function CompareView({ database }) {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!database) return
    let cancelled = false
    setState({ loading: true, error: null, data: null })
    setSelected(null)

    fetchCompare(database)
      .then((data) => {
        if (cancelled) return
        setState({ loading: false, error: null, data })
      })
      .catch((err) => {
        if (cancelled) return
        setState({ loading: false, error: err.message, data: null })
      })

    return () => {
      cancelled = true
    }
  }, [database])

  const { loading, error, data } = state
  const groups = (data?.groups ?? []).filter((g) => g.items.length > 0)
  const dev = data?.dev
  const prod = data?.prod

  return (
    <div className="viewer-body">
      <aside className="sidebar" aria-label="Comparison results">
        <h2>Compare</h2>
        <p className="sidebar-hint">
          {dev && prod ? (
            <>
              {dev.label} vs {prod.label}
            </>
          ) : (
            'Dev vs Prod'
          )}
        </p>
        {loading && <p className="muted">Comparing…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && groups.length === 0 && (
          <p className="muted">No objects found.</p>
        )}
        <div className="sidebar-scroll">
          {groups.map((group) => (
            <section key={group.id} className="object-group">
              <h3 className={`group-header diff-${group.id}`}>
                {group.label}
                <span className="group-count">{group.items.length}</span>
              </h3>
              <ul className="object-list">
                {group.items.map((o) => (
                  <li key={`${group.id}-${o.schema}.${o.name}`}>
                    <button
                      type="button"
                      className={
                        selected?.schema === o.schema &&
                        selected?.name === o.name &&
                        selected?.status === group.id
                          ? 'active'
                          : ''
                      }
                      onClick={() => setSelected({ ...o, status: group.id })}
                    >
                      <span className="obj-name">
                        {o.schema}.{o.name}
                      </span>
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
            Select an object to compare its definition across servers.
          </p>
        )}
        {selected && dev && prod && (
          <CompareDetail
            database={database}
            item={selected}
            dev={dev}
            prod={prod}
          />
        )}
      </main>
    </div>
  )
}

function CompareDetail({ database, item, dev, prod }) {
  const [state, setState] = useState({ loading: true, error: null, devText: '', prodText: '' })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, devText: '', prodText: '' })

    const wantDev = item.status !== 'onlyProd' && item.status !== 'ignored'
    const wantProd = item.status !== 'onlyDev'

    Promise.all([
      wantDev ? fetchDefinitionFor(database, item, dev.id) : Promise.resolve(null),
      wantProd ? fetchDefinitionFor(database, item, prod.id) : Promise.resolve(null),
    ])
      .then(([devData, prodData]) => {
        if (cancelled) return
        setState({
          loading: false,
          error: null,
          devText: devData?.definition ?? '',
          prodText: prodData?.definition ?? '',
        })
      })
      .catch((err) => {
        if (cancelled) return
        setState({ loading: false, error: err.message, devText: '', prodText: '' })
      })

    return () => {
      cancelled = true
    }
  }, [database, item, dev.id, prod.id])

  const { loading, error, devText, prodText } = state
  const bothSides = item.status === 'different' || item.status === 'same'
  const columns = bothSides ? diffColumns(devText, prodText) : null

  return (
    <>
      <h2>
        {item.schema}.{item.name}
        <span className={`type-badge badge-${item.status}`}>{statusLabel(item.status)}</span>
      </h2>

      {loading && <p className="muted">Loading definitions…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && bothSides && (
        <div className="side-by-side">
          <DiffColumn label={dev.label} tone="del" lines={columns.left} />
          <DiffColumn label={prod.label} tone="add" lines={columns.right} />
        </div>
      )}

      {!loading && !error && !bothSides && (
        <pre className="definition">
          <code>{(item.status === 'onlyDev' ? devText : prodText) || 'No definition text.'}</code>
        </pre>
      )}
    </>
  )
}

function DiffColumn({ label, tone, lines }) {
  return (
    <div className="diff-column">
      <h3 className="diff-column-title">{label}</h3>
      <pre className="definition">
        <code>
          {lines.map((line, idx) => (
            <span
              key={idx}
              className={line.changed ? `diff-line diff-line--${tone}` : 'diff-line'}
            >
              {line.text || '\u00a0'}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function statusLabel(status) {
  switch (status) {
    case 'different':
      return 'Different'
    case 'onlyDev':
      return 'Only in Dev'
    case 'onlyProd':
      return 'Only in Prod'
    case 'ignored':
      return 'Ignored'
    case 'same':
      return 'Identical'
    default:
      return status
  }
}

function shortType(typeDesc) {
  return typeDesc
    .replace('SQL_', '')
    .replace(/_/g, ' ')
    .toLowerCase()
}

export default App
