import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import type { Editor as TipTapEditor, JSONContent } from '@tiptap/react'

interface Props {
  content: JSONContent | null
  onChange: (content: JSONContent) => void
}

export function Editor({ content, onChange }: Props) {
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Écrivez ici…' }),
    ],
    content: content ?? '',
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
      <Toolbar editor={editor} />
    </>
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
      code: e.isActive('codeBlock'),
      canSink: e.can().sinkListItem('listItem') || e.can().sinkListItem('taskItem'),
      canLift: e.can().liftListItem('listItem') || e.can().liftListItem('taskItem'),
    }),
  })
  const c = () => editor.chain().focus()
  // onMouseDown/preventDefault : évite de perdre le focus (et donc de fermer le clavier).
  const btn = (label: string, active: boolean, run: () => void, disabled = false, aria = label) => (
    <button
      type="button"
      className={active ? 'active' : ''}
      disabled={disabled}
      aria-label={aria}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {label}
    </button>
  )
  return (
    <div className="toolbar" role="toolbar">
      {/* Indentation : remplace la touche Tab absente sur mobile, visible seulement dans une liste. */}
      {(s.canLift || s.canSink) && btn('⇤', false, () => {
        if (!c().liftListItem('taskItem').run()) c().liftListItem('listItem').run()
      }, !s.canLift, 'Désindenter')}
      {(s.canLift || s.canSink) && btn('⇥', false, () => {
        if (!c().sinkListItem('taskItem').run()) c().sinkListItem('listItem').run()
      }, !s.canSink, 'Indenter')}
      {btn('☐', s.task, () => c().toggleTaskList().run(), false, 'Tâches')}
      {btn('•', s.bullet, () => c().toggleBulletList().run(), false, 'Liste à puces')}
      {btn('1.', s.ordered, () => c().toggleOrderedList().run(), false, 'Liste numérotée')}
      {btn('H1', s.h1, () => c().toggleHeading({ level: 1 }).run(), false, 'Titre 1')}
      {btn('H2', s.h2, () => c().toggleHeading({ level: 2 }).run(), false, 'Titre 2')}
      {btn('B', s.bold, () => c().toggleBold().run(), false, 'Gras')}
      {btn('I', s.italic, () => c().toggleItalic().run(), false, 'Italique')}
      {btn('❝', s.quote, () => c().toggleBlockquote().run(), false, 'Citation')}
      {btn('</>', s.code, () => c().toggleCodeBlock().run(), false, 'Bloc de code')}
    </div>
  )
}
