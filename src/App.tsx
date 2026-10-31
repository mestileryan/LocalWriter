import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { JSONContent } from '@tiptap/react'
import { db, createPage, deletePage, exportAll, importAll, type Page } from './db'
import { Editor } from './Editor'
import { norm, plainText } from './text'

// Résultats de recherche : titre + extrait autour de la première occurrence.
function SearchResults({ pages, query, onOpen }: { pages: Page[]; query: string; onOpen: (id: string) => void }) {
  const q = norm(query)
  const hits = pages.flatMap((p) => {
    const text = plainText(p.content)
    const inTitle = norm(p.title).includes(q)
    const at = norm(text).indexOf(q)
    if (!inTitle && at < 0) return []
    const snippet = at < 0 ? text.slice(0, 80) : text.slice(Math.max(0, at - 30), at + 50)
    return [{ page: p, snippet }]
  })
  if (!hits.length) return <p className="empty">Aucun résultat.</p>
  return (
    <>
      {hits.map(({ page, snippet }) => (
        <button key={page.id} className="hit" onClick={() => onOpen(page.id)}>
          <span className="hit-title">{page.title || 'Sans titre'}</span>
          {snippet && <span className="hit-snippet">{snippet}</span>}
        </button>
      ))}
    </>
  )
}

function useHashId(): [string | null, (id: string | null) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '') || null
  const [id, setId] = useState(read)
  useEffect(() => {
    const on = () => setId(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [id, (next) => { window.location.hash = next ? `/${next}` : '' }]
}

function PageTree({ pages, parentId, depth, currentId, onOpen, onAddChild }: {
  pages: Page[]
  parentId: string | null
  depth: number
  currentId: string | null
  onOpen: (id: string) => void
  onAddChild: (id: string) => void
}) {
  const items = pages.filter((p) => p.parentId === parentId)
  return (
    <>
      {items.map((p) => (
        <div key={p.id}>
          <div className={`row${p.id === currentId ? ' current' : ''}`} style={{ paddingLeft: 12 + depth * 20 }}>
            <button className="row-main" onClick={() => onOpen(p.id)}>
              {p.title || 'Sans titre'}
            </button>
            <button className="row-add" aria-label="Ajouter une sous-page" onClick={() => onAddChild(p.id)}>＋</button>
          </div>
          <PageTree pages={pages} parentId={p.id} depth={depth + 1} currentId={currentId} onOpen={onOpen} onAddChild={onAddChild} />
        </div>
      ))}
    </>
  )
}

function PageView({ page, onBack, onDelete }: { page: Page; onBack: () => void; onDelete: () => void }) {
  const timer = useRef<number | undefined>(undefined)

  const pending = useRef<Partial<Page>>({})

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const patch = pending.current
    pending.current = {}
    if (Object.keys(patch).length) db.pages.update(page.id, { ...patch, updatedAt: Date.now() })
  }, [page.id])
  const save = (patch: Partial<Page>) => {
    pending.current = { ...pending.current, ...patch }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, 300)
  }
  // Écrit les modifications en attente quand on quitte la page ou l'onglet.
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  return (
    <main className="page">
      <header className="topbar">
        <button className="back" onClick={onBack} aria-label="Retour à la liste">←</button>
        <button className="danger" onClick={() => { if (confirm('Supprimer cette page et ses sous-pages ?')) onDelete() }}>Supprimer</button>
      </header>
      <input
        className="title"
        defaultValue={page.title}
        placeholder="Sans titre"
        autoFocus={!page.title}
        onChange={(e) => save({ title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          document.querySelector<HTMLElement>('.ProseMirror')?.focus()
        }}
      />
      <Editor content={page.content} onChange={(content: JSONContent) => save({ content })} />
    </main>
  )
}

export default function App() {
  const [id, setId] = useHashId()
  const [query, setQuery] = useState('')
  const pages = useLiveQuery(() => db.pages.orderBy('createdAt').toArray(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const current = useMemo(() => pages?.find((p) => p.id === id) ?? null, [pages, id])
  // Une page dont le parent n'existe plus (import partiel, par ex.) remonte à la racine au lieu de disparaître.
  const tree = useMemo(() => {
    if (!pages) return []
    const ids = new Set(pages.map((p) => p.id))
    return pages.map((p) => (p.parentId && !ids.has(p.parentId) ? { ...p, parentId: null } : p))
  }, [pages])

  const add = async (parentId: string | null) => setId(await createPage(parentId))

  const doExport = async () => {
    const url = URL.createObjectURL(new Blob([await exportAll()], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'localwriter-backup.json' })
    a.click()
    URL.revokeObjectURL(url)
  }
  const doImport = async (file: File) => {
    try {
      alert(`${await importAll(await file.text())} pages importées.`)
    } catch {
      alert('Fichier invalide.')
    }
  }

  if (!pages) return null
  return (
    <div className={`app${current ? ' has-page' : ''}`}>
      <nav className="sidebar">
        <header className="topbar">
          <h1>LocalWriter</h1>
        </header>
        <input
          className="search"
          type="search"
          placeholder="Rechercher…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="list">
          {query.trim()
            ? <SearchResults pages={pages} query={query.trim()} onOpen={setId} />
            : <>
                {pages.length === 0 && <p className="empty">Aucune page. Créez-en une avec le bouton ＋.</p>}
                <PageTree pages={tree} parentId={null} depth={0} currentId={id} onOpen={setId} onAddChild={add} />
              </>}
        </div>
        <footer className="sidebar-foot">
          <button onClick={doExport}>Exporter</button>
          <button onClick={() => fileRef.current?.click()}>Importer</button>
          <input ref={fileRef} type="file" accept="application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
        </footer>
        <button className="fab" aria-label="Nouvelle page" onClick={() => add(null)}>＋</button>
      </nav>
      {current
        ? <PageView key={current.id} page={current} onBack={() => setId(null)} onDelete={async () => { await deletePage(current.id); setId(null) }} />
        : <main className="page placeholder-page"><p>Sélectionnez ou créez une page.</p></main>}
    </div>
  )
}
