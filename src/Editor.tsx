import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { TextSelection } from '@tiptap/pm/state'
import type { ResolvedPos } from '@tiptap/pm/model'
import type { ChainedCommands, Editor as TipTapEditor, JSONContent } from '@tiptap/react'
import { norm } from './text'

interface Props {
  content: JSONContent | null
  onChange: (content: JSONContent) => void
}

type KeyHandler = (event: KeyboardEvent) => boolean

export function Editor({ content, onChange }: Props) {
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  // Le menu « / » intercepte flèches et Entrée quand il est ouvert.
  const slashKey = useRef<KeyHandler>(() => false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Écrivez ici… (« / » pour insérer un bloc)' }),
    ],
    content: content ?? '',
    editorProps: { handleKeyDown: (_view, event) => slashKey.current(event) },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getJSON()),
  })

  // Garde la barre d'outils collée au-dessus du clavier virtuel.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop
      document.documentElement.style.setProperty('--kb', `${Math.max(0, offset)}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  if (!editor) return null
  return (
    <>
      <EditorContent editor={editor} className="editor" />
      <BlockHandle editor={editor} />
      <SlashMenu editor={editor} keyRef={slashKey} />
      <Toolbar editor={editor} />
      {window.location.search.includes('debug') && <DebugOverlay editor={editor} />}
    </>
  )
}

// Profondeur du « bloc déplaçable » : l'élément de liste englobant s'il y en a un, sinon le bloc de premier niveau.
function blockDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d >= 1; d--) {
    const name = $pos.node(d).type.name
    if (name === 'listItem' || name === 'taskItem') return d
  }
  return 1
}
// Identifie le parent d'un bloc, pour n'autoriser le dépôt qu'entre frères (le schéma refuserait le reste).
const parentKey = ($pos: ResolvedPos, depth: number) => (depth === 1 ? -1 : $pos.before(depth - 1))

// Déplace d'un cran le bloc courant.
function moveBlock(editor: TipTapEditor, dir: -1 | 1): boolean {
  const { state, view } = editor
  const { $from } = state.selection
  if ($from.depth < 1) return false
  const depth = blockDepth($from)
  const node = $from.node(depth)
  const parent = $from.node(depth - 1)
  const index = $from.index(depth - 1)
  const target = index + dir
  if (target < 0 || target >= parent.childCount) return false
  const sibling = parent.child(target)
  const start = $from.before(depth)
  const end = $from.after(depth)
  const offset = $from.pos - start
  const tr = state.tr
  let cursor: number
  if (dir === -1) {
    tr.replaceWith(start - sibling.nodeSize, end, [node, sibling])
    cursor = start - sibling.nodeSize + offset
  } else {
    tr.replaceWith(start, end + sibling.nodeSize, [sibling, node])
    cursor = start + sibling.nodeSize + offset
  }
  tr.setSelection(TextSelection.create(tr.doc, cursor)).scrollIntoView()
  view.dispatch(tr)
  view.focus()
  return true
}

// Coordonnées d'un élément dans le repère du conteneur défilant.
function relRect(sc: HTMLElement | null, el: Element) {
  if (!sc) return null
  const r = el.getBoundingClientRect()
  const s = sc.getBoundingClientRect()
  return { top: r.top - s.top + sc.scrollTop, left: r.left - s.left + sc.scrollLeft, width: r.width, height: r.height }
}

// Poignée ⋮⋮ à gauche du bloc courant, hors de la zone éditable : on la maintient et on glisse
// pour déplacer le bloc (l'appui long dans le texte lui-même déclencherait la sélection sur mobile).
function BlockHandle({ editor }: { editor: TipTapEditor }) {
  const info = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from } = e.state.selection
      if ($from.depth < 1) return null
      const depth = blockDepth($from)
      // docSize force une nouvelle mesure quand le texte change de hauteur.
      return { start: $from.before(depth), end: $from.after(depth), depth, docSize: e.state.doc.content.size }
    },
  })
  const [drop, setDrop] = useState<{ top: number; left: number; width: number } | null>(null)
  // Calque posé sur le bloc source pendant le glisser (ProseMirror effacerait une classe ajoutée à son DOM).
  const [ghost, setGhost] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const drag = useRef<{ start: number; end: number; parent: number; target?: { pos: number } } | null>(null)

  const scroller = () => editor.view.dom.closest<HTMLElement>('.page')
  const rel = (el: Element) => relRect(scroller(), el)

  // Le DOM de l'éditeur est déjà à jour quand React re-rend : on peut le mesurer directement.
  const pos = useMemo(() => {
    if (!info) return null
    const dom = editor.view.nodeDOM(info.start)
    const r = dom instanceof HTMLElement ? rel(dom) : null
    const ed = rel(editor.view.dom)
    return r && ed ? { top: r.top, left: ed.left } : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, editor])

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!info) return
    e.preventDefault()
    const dom = editor.view.nodeDOM(info.start)
    if (!(dom instanceof HTMLElement)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const $from = editor.state.doc.resolve(info.start + 1)
    drag.current = { start: info.start, end: info.end, parent: parentKey($from, info.depth) }
    setGhost(rel(dom))
    navigator.vibrate?.(10)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const sc = scroller()
    if (sc) {
      // Défilement automatique près des bords.
      const s = sc.getBoundingClientRect()
      if (e.clientY < s.top + 60) sc.scrollTop -= 10
      else if (e.clientY > s.bottom - 60) sc.scrollTop += 10
    }
    const edRect = editor.view.dom.getBoundingClientRect()
    const hit = editor.view.posAtCoords({ left: edRect.left + 60, top: e.clientY })
    if (!hit) return
    const $t = editor.state.doc.resolve(hit.pos)
    // On remonte jusqu'à un bloc frère du bloc déplacé.
    let depth = 0
    for (let k = $t.depth; k >= 1; k--) if (parentKey($t, k) === d.parent) { depth = k; break }
    if (!depth) { d.target = undefined; setDrop(null); return }
    const tStart = $t.before(depth)
    const tEnd = $t.after(depth)
    if (tStart === d.start) { d.target = undefined; setDrop(null); return }
    const tDom = editor.view.nodeDOM(tStart)
    if (!(tDom instanceof HTMLElement)) return
    const r = rel(tDom)
    if (!r) return
    const box = tDom.getBoundingClientRect()
    const after = e.clientY > box.top + box.height / 2
    d.target = { pos: after ? tEnd : tStart }
    setDrop({ top: after ? r.top + r.height : r.top, left: r.left, width: r.width })
  }

  const onPointerUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setGhost(null)
    setDrop(null)
    if (!d.target) return
    const { state, view } = editor
    const node = state.doc.nodeAt(d.start)
    if (!node) return
    const tr = state.tr.delete(d.start, d.end)
    const ins = tr.mapping.map(d.target.pos)
    tr.insert(ins, node)
    tr.setSelection(TextSelection.near(tr.doc.resolve(ins + 1))).scrollIntoView()
    view.dispatch(tr)
  }

  if (!pos) return null
  return (
    <>
      <button
        type="button"
        className="block-handle"
        aria-label="Déplacer le bloc (maintenir et glisser)"
        style={{ top: pos.top, left: pos.left }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        ⋮⋮
      </button>
      {ghost && <div className="drag-ghost" style={ghost} />}
      {drop && <div className="drop-line" style={{ top: drop.top, left: drop.left, width: drop.width }} />}
    </>
  )
}

interface SlashItem { label: string; keys: string; run: (c: ChainedCommands) => ChainedCommands }
const SLASH_ITEMS: SlashItem[] = [
  { label: 'Texte', keys: 'paragraphe', run: (c) => c.setParagraph() },
  { label: 'Titre 1', keys: 'h1', run: (c) => c.setHeading({ level: 1 }) },
  { label: 'Titre 2', keys: 'h2', run: (c) => c.setHeading({ level: 2 }) },
  { label: 'Tâches', keys: 'todo case cocher', run: (c) => c.toggleTaskList() },
  { label: 'Liste à puces', keys: 'bullet', run: (c) => c.toggleBulletList() },
  { label: 'Liste numérotée', keys: 'nombre', run: (c) => c.toggleOrderedList() },
  { label: 'Citation', keys: 'quote', run: (c) => c.toggleBlockquote() },
  { label: 'Code', keys: 'bloc', run: (c) => c.toggleCodeBlock() },
  { label: 'Séparateur', keys: 'ligne hr', run: (c) => c.setHorizontalRule() },
]

function SlashMenu({ editor, keyRef }: { editor: TipTapEditor; keyRef: RefObject<KeyHandler> }) {
  // Ouvert quand le paragraphe courant ne contient que « /mot » et que le curseur est à la fin.
  const slash = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { $from, empty } = e.state.selection
      if (!empty || $from.parent.type.name !== 'paragraph') return null
      const text = $from.parent.textContent
      const m = /^\/(\S*)$/.exec(text)
      if (!m || $from.parentOffset !== text.length) return null
      return { query: m[1], from: $from.start(), to: $from.pos }
    },
  })
  // La sélection est liée à la requête : changer de requête revient en haut de la liste.
  const [sel, setSel] = useState({ query: '', idx: 0 })
  const query = slash?.query ?? ''
  const idx = sel.query === query ? sel.idx : 0
  const setIdx = (f: (i: number) => number) => setSel({ query, idx: f(idx) })

  const items = slash ? SLASH_ITEMS.filter((i) => norm(`${i.label} ${i.keys}`).includes(norm(slash.query))) : []
  const apply = (item: SlashItem) => {
    if (!slash) return
    item.run(editor.chain().focus().deleteRange({ from: slash.from, to: slash.to })).run()
  }

  useEffect(() => {
    keyRef.current = (e) => {
      if (!items.length) return false
      if (e.key === 'ArrowDown') { setIdx((i) => (i + 1) % items.length); return true }
      if (e.key === 'ArrowUp') { setIdx((i) => (i - 1 + items.length) % items.length); return true }
      if (e.key === 'Enter') { apply(items[Math.min(idx, items.length - 1)]); return true }
      return false
    }
  })

  if (!items.length) return null
  return (
    <div className="slash-menu" role="listbox">
      {items.map((it, i) => (
        <button
          key={it.label}
          type="button"
          role="option"
          aria-selected={i === idx}
          className={i === idx ? 'active' : ''}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(it)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

function Toolbar({ editor }: { editor: TipTapEditor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      // Impossible d'envelopper un élément de liste dans une citation : on grise plutôt que de laisser un bouton muet.
      canQuote: e.isActive('blockquote') || e.can().toggleBlockquote(),
      code: e.isActive('codeBlock'),
      canSink: e.can().sinkListItem('listItem') || e.can().sinkListItem('taskItem'),
      canLift: e.can().liftListItem('listItem') || e.can().liftListItem('taskItem'),
    }),
  })
  const c = () => editor.chain().focus()
  // preventDefault sur pointerdown ET mousedown : le bouton ne prend jamais le focus,
  // l'éditeur garde le sien et le clavier reste ouvert (Android envoie les deux).
  const btn = (label: string, active: boolean, run: () => void, disabled = false, aria = label) => (
    <button
      type="button"
      className={active ? 'active' : ''}
      disabled={disabled}
      aria-label={aria}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )
  // Toujours les mêmes boutons dans le même ordre : un bouton qui apparaît décalerait les autres sous le doigt.
  return (
    <div className="toolbar" role="toolbar" onScroll={(e) => {
      const el = e.currentTarget
      el.classList.toggle('at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)
    }}>
      {btn('☑', s.task, () => c().toggleTaskList().run(), false, 'Tâches')}
      {btn('•', s.bullet, () => c().toggleBulletList().run(), false, 'Liste à puces')}
      {btn('1.', s.ordered, () => c().toggleOrderedList().run(), false, 'Liste numérotée')}
      {btn('⇤', false, () => {
        if (!c().liftListItem('taskItem').run()) c().liftListItem('listItem').run()
      }, !s.canLift, 'Désindenter')}
      {btn('⇥', false, () => {
        if (!c().sinkListItem('taskItem').run()) c().sinkListItem('listItem').run()
      }, !s.canSink, 'Indenter')}
      {btn('↑', false, () => moveBlock(editor, -1), false, 'Monter le bloc')}
      {btn('↓', false, () => moveBlock(editor, 1), false, 'Descendre le bloc')}
      {btn('B', s.bold, () => c().toggleBold().run(), false, 'Gras')}
      {btn('I', s.italic, () => c().toggleItalic().run(), false, 'Italique')}
      {btn('H1', s.h1, () => c().toggleHeading({ level: 1 }).run(), false, 'Titre 1')}
      {btn('H2', s.h2, () => c().toggleHeading({ level: 2 }).run(), false, 'Titre 2')}
      {btn('❝', s.quote, () => c().toggleBlockquote().run(), !s.canQuote, 'Citation')}
      {btn('</>', s.code, () => c().toggleCodeBlock().run(), false, 'Bloc de code')}
    </div>
  )
}

// Panneau de diagnostic (`?debug=1`) : viewport, clavier, focus, composition IME et événements sur les commandes.
function DebugOverlay({ editor }: { editor: TipTapEditor }) {
  const [snap, setSnap] = useState('')
  const [events, setEvents] = useState<string[]>([])
  useEffect(() => {
    const vv = window.visualViewport
    const tick = () => setSnap(
      `ih=${window.innerHeight} vv=${Math.round(vv?.height ?? 0)}+${Math.round(vv?.offsetTop ?? 0)} ` +
      `kb=${getComputedStyle(document.documentElement).getPropertyValue('--kb').trim()} ` +
      `comp=${editor.view.composing ? 1 : 0} focus=${document.activeElement?.className.split(' ')[0] || document.activeElement?.tagName} ` +
      `sel=${editor.state.selection.from}`,
    )
    const id = window.setInterval(tick, 300)
    const log = (s: string) => setEvents((l) => [...l.slice(-7), `${new Date().toISOString().slice(14, 23)} ${s}`])
    const onEv = (e: Event) => {
      const t = e.target instanceof Element ? e.target.closest('button') : null
      if (t?.closest('.toolbar, .block-handle, .slash-menu')) log(`${e.type} ${t.getAttribute('aria-label') ?? t.textContent}`)
    }
    const types = ['pointerdown', 'pointerup', 'mousedown', 'click', 'touchend']
    types.forEach((ty) => document.addEventListener(ty, onEv, true))
    const onBlur = () => log('editor blur')
    const onFocus = () => log('editor focus')
    editor.on('blur', onBlur)
    editor.on('focus', onFocus)
    const onErr = (e: ErrorEvent) => log(`ERREUR ${e.message}`)
    window.addEventListener('error', onErr)
    return () => {
      window.clearInterval(id)
      types.forEach((ty) => document.removeEventListener(ty, onEv, true))
      editor.off('blur', onBlur)
      editor.off('focus', onFocus)
      window.removeEventListener('error', onErr)
    }
  }, [editor])
  return <pre className="debug">{snap}{'\n'}{events.join('\n')}</pre>
}
