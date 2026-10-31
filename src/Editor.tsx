import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { Details, DetailsSummary, DetailsContent } from '@tiptap/extension-details'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { ChainedCommands, Editor as TipTapEditor, JSONContent } from '@tiptap/react'
import { norm } from './text'
import { lines, lineAt, relocate, targets, type Line } from './blocks'
import { resolveSrc, storeImage } from './images'

interface Props {
  content: JSONContent | null
  onChange: (content: JSONContent) => void
}

type KeyHandler = (event: KeyboardEvent) => boolean

const DEBUG = window.location.search.includes('debug')
// Journal visible dans le panneau ?debug=1 (voir DebugOverlay).
const dbg = (msg: string) => { if (DEBUG) window.dispatchEvent(new CustomEvent('lw-debug', { detail: msg })) }

// Image dont la source `lw://<id>` est résolue depuis IndexedDB au rendu.
const LocalImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img')
      img.alt = node.attrs.alt ?? ''
      img.draggable = false
      let current = ''
      const load = (src: string) => {
        if (src === current) return
        current = src
        resolveSrc(src).then((url) => { if (current === src) img.src = url })
      }
      load(node.attrs.src)
      return {
        dom: img,
        update: (n) => {
          if (n.type !== node.type) return false
          load(n.attrs.src)
          return true
        },
      }
    }
  },
})

// Entrée dans le titre d'un bloc pliable : on l'ouvre et on entre dans son contenu. Géré dans
// handleKeyDown, avant tous les raccourcis des extensions (celui de Details insérerait un bloc).
function enterInSummary(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Enter') return false
  const { $from } = view.state.selection
  if ($from.parent.type.name !== 'detailsSummary') return false
  const detailsPos = $from.before($from.depth - 1)
  const details = view.state.doc.nodeAt(detailsPos)
  if (!details) return false
  const tr = view.state.tr.setNodeMarkup(detailsPos, undefined, { ...details.attrs, open: true })
  const inside = detailsPos + 1 + details.child(0).nodeSize + 2
  tr.setSelection(TextSelection.near(tr.doc.resolve(inside))).scrollIntoView()
  view.dispatch(tr)
  dbg(`enterInSummary → sel ${view.state.selection.from} dans ${view.state.selection.$from.parent.type.name}`)
  return true
}

// Sélecteur de fichier (galerie ou appareil photo sur mobile), puis insertion de l'image réduite.
function pickImage(editor: TipTapEditor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const src = await storeImage(file)
    editor.chain().focus().setImage({ src, alt: file.name }).run()
  }
  input.click()
}

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
      LocalImage,
      Details.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'detailsSummary' ? 'Titre du bloc pliable' : 'Écrivez ici… (« / » pour insérer un bloc)'),
      }),
    ],
    content: content ?? '',
    editorProps: { handleKeyDown: (_view, event) => slashKey.current(event) },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getJSON()),
  })

  // Entrée dans le titre d'un bloc pliable, capté avant ProseMirror : la vue de nœud de Details
  // ne laisse pas passer la touche jusqu'à handleKeyDown.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const onKey = (e: KeyboardEvent) => { if (enterInSummary(editor.view, e)) { e.preventDefault(); e.stopPropagation() } }
    dom.addEventListener('keydown', onKey, true)
    return () => dom.removeEventListener('keydown', onKey, true)
  }, [editor])

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

type Targets = ReturnType<typeof targets>

// Déplace la ligne courante vers une des cibles calculées par `targets` (↑ ↓ ⇤ ⇥).
function moveLine(editor: TipTapEditor, pick: (t: Targets) => number | null): boolean {
  const t = targets(editor.state)
  const target = pick(t)
  if (!t.line || target === null) return false
  const tr = relocate(editor.state, t.line, target)
  if (!tr) return false
  editor.view.dispatch(tr)
  editor.view.focus()
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
      const line = lineAt(lines(e.state.doc), e.state.selection.from)
      // docSize force une nouvelle mesure quand le texte change de hauteur.
      return line ? { start: line.pos, docSize: e.state.doc.content.size } : null
    },
  })
  const [drop, setDrop] = useState<{ top: number; left: number; width: number } | null>(null)
  // Calque posé sur le bloc source pendant le glisser (ProseMirror effacerait une classe ajoutée à son DOM).
  const [ghost, setGhost] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const drag = useRef<{ line: Line; ls: Line[]; target?: number; moves: number; cleanup: () => void } | null>(null)
  const [armed, setArmed] = useState(false)

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

  const onMove = (clientY: number) => {
    const d = drag.current
    if (!d) return
    d.moves++
    const sc = scroller()
    if (sc) {
      // Défilement automatique près des bords.
      const s = sc.getBoundingClientRect()
      if (clientY < s.top + 60) sc.scrollTop -= 10
      else if (clientY > s.bottom - 60) sc.scrollTop += 10
    }
    const edRect = editor.view.dom.getBoundingClientRect()
    const hit = editor.view.posAtCoords({ left: edRect.left + 60, top: clientY })
    if (!hit) { if (d.moves % 10 === 1) dbg(`move ${d.moves} y=${Math.round(clientY)} hit=null`); return }
    // Ligne sous le doigt, n'importe où dans le document, sauf le bloc déplacé lui-même.
    const t = lineAt(d.ls, hit.pos)
    const src = d.line
    const before = d.target
    if (!t || (t.pos >= src.pos && t.pos < src.pos + src.node.nodeSize)) { d.target = undefined; setDrop(null) }
    else {
      const tDom = editor.view.nodeDOM(t.pos)
      if (!(tDom instanceof HTMLElement)) return
      const r = rel(tDom)
      if (!r) return
      const box = tDom.getBoundingClientRect()
      const after = clientY > box.top + box.height / 2
      d.target = after ? t.pos + t.node.nodeSize : t.pos
      setDrop({ top: after ? r.top + r.height : r.top, left: r.left, width: r.width })
    }
    if (d.target !== before || d.moves % 10 === 1) dbg(`move ${d.moves} y=${Math.round(clientY)} hit=${hit.pos} cible=${d.target ?? '-'}`)
  }

  const finish = (why: string) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    d.cleanup()
    setArmed(false)
    setGhost(null)
    setDrop(null)
    dbg(`drag fin (${why}) moves=${d.moves} cible=${d.target ?? '-'}`)
    if (d.target === undefined) return
    const tr = relocate(editor.state, d.line, d.target)
    dbg(`relocate → ${tr ? 'ok' : 'refusé'}`)
    if (tr) editor.view.dispatch(tr)
  }

  // Le suivi du doigt est fait par des écouteurs natifs sur window, indépendants de la capture
  // du pointeur, et touchmove est bloqué explicitement : aucun défilement pendant le glisser.
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const ls = lines(editor.state.doc)
    const line = lineAt(ls, editor.state.selection.from)
    if (!line) { dbg('drag : aucune ligne sous le curseur'); return }
    e.preventDefault()
    const dom = editor.view.nodeDOM(line.pos)
    if (!(dom instanceof HTMLElement)) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sans importance */ }
    const pmove = (ev: PointerEvent) => onMove(ev.clientY)
    const tmove = (ev: TouchEvent) => { ev.preventDefault(); const t = ev.touches[0]; if (t) onMove(t.clientY) }
    const pup = () => finish('pointerup')
    const pcancel = () => finish('pointercancel')
    const tend = () => finish('touchend')
    const ctx = (ev: Event) => ev.preventDefault()
    window.addEventListener('pointermove', pmove)
    window.addEventListener('pointerup', pup)
    window.addEventListener('pointercancel', pcancel)
    window.addEventListener('touchmove', tmove, { passive: false })
    window.addEventListener('touchend', tend)
    window.addEventListener('contextmenu', ctx)
    const cleanup = () => {
      window.removeEventListener('pointermove', pmove)
      window.removeEventListener('pointerup', pup)
      window.removeEventListener('pointercancel', pcancel)
      window.removeEventListener('touchmove', tmove)
      window.removeEventListener('touchend', tend)
      window.removeEventListener('contextmenu', ctx)
    }
    drag.current = { line, ls, moves: 0, cleanup }
    setArmed(true)
    setGhost(rel(dom))
    navigator.vibrate?.(10)
    dbg(`drag début (${e.pointerType}) ligne=${line.pos} ${line.node.type.name}`)
  }

  if (!pos) return null
  return (
    <>
      <button
        type="button"
        className={`block-handle${armed ? ' armed' : ''}`}
        aria-label="Déplacer le bloc (maintenir et glisser)"
        style={{ top: pos.top, left: pos.left }}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        ⋮⋮
      </button>
      {ghost && <div className="drag-ghost" style={ghost} />}
      {drop && <div className="drop-line" style={{ top: drop.top, left: drop.left, width: drop.width }} />}
    </>
  )
}

interface SlashItem { label: string; keys: string; run: (c: ChainedCommands) => ChainedCommands; after?: (editor: TipTapEditor) => void }
const SLASH_ITEMS: SlashItem[] = [
  { label: 'Texte', keys: 'paragraphe', run: (c) => c.setParagraph() },
  // Créé ouvert : replié, Entrée dans le titre créerait un nouveau bloc au lieu d'entrer dans le contenu.
  { label: 'Pliable', keys: 'toggle plier déplier', run: (c) => c.setDetails().updateAttributes('details', { open: true }) },
  { label: 'Image', keys: 'photo', run: (c) => c, after: pickImage },
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
    item.after?.(editor)
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
      details: e.isActive('details'),
      canDetails: e.isActive('details') || e.can().setDetails(),
      ...(({ up, down, indent, outdent }) => ({
        canUp: up !== null, canDown: down !== null, canIndent: indent !== null, canOutdent: outdent !== null,
      }))(targets(e.state)),
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
      {btn('⇤', false, () => moveLine(editor, (t) => t.outdent), !s.canOutdent, 'Désindenter')}
      {btn('⇥', false, () => moveLine(editor, (t) => t.indent), !s.canIndent, 'Indenter')}
      {btn('↑', false, () => moveLine(editor, (t) => t.up), !s.canUp, 'Monter le bloc')}
      {btn('↓', false, () => moveLine(editor, (t) => t.down), !s.canDown, 'Descendre le bloc')}
      {btn('B', s.bold, () => c().toggleBold().run(), false, 'Gras')}
      {btn('I', s.italic, () => c().toggleItalic().run(), false, 'Italique')}
      {btn('H1', s.h1, () => c().toggleHeading({ level: 1 }).run(), false, 'Titre 1')}
      {btn('H2', s.h2, () => c().toggleHeading({ level: 2 }).run(), false, 'Titre 2')}
      {btn('❝', s.quote, () => c().toggleBlockquote().run(), !s.canQuote, 'Citation')}
      {btn('</>', s.code, () => c().toggleCodeBlock().run(), false, 'Bloc de code')}
      {btn('▸', s.details, () => {
        if (s.details) c().unsetDetails().run()
        else c().setDetails().updateAttributes('details', { open: true }).run()
      }, !s.canDetails, 'Bloc pliable')}
      {btn('🖼', false, () => pickImage(editor), false, 'Image')}
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
    const types = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'click', 'touchend']
    types.forEach((ty) => document.addEventListener(ty, onEv, true))
    const onDbg = (e: Event) => log((e as CustomEvent<string>).detail)
    window.addEventListener('lw-debug', onDbg)
    const onBlur = () => log('editor blur')
    const onFocus = () => log('editor focus')
    editor.on('blur', onBlur)
    editor.on('focus', onFocus)
    const onErr = (e: ErrorEvent) => log(`ERREUR ${e.message}`)
    window.addEventListener('error', onErr)
    return () => {
      window.clearInterval(id)
      types.forEach((ty) => document.removeEventListener(ty, onEv, true))
      window.removeEventListener('lw-debug', onDbg)
      editor.off('blur', onBlur)
      editor.off('focus', onFocus)
      window.removeEventListener('error', onErr)
    }
  }, [editor])
  return <pre className="debug">{snap}{'\n'}{events.join('\n')}</pre>
}
