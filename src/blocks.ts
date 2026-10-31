// Modèle « lignes » façon Notion par-dessus le schéma ProseMirror.
//
// Pour l'utilisateur, chaque ligne (paragraphe, titre, élément de liste…) est un bloc qu'on
// déplace, indente ou désindente librement. Dans le schéma, les listes sont des conteneurs
// (bulletList > listItem > paragraph) : ce module découpe, enveloppe et refusionne les listes
// pour que le résultat ait l'air plat.
import type { Node as PMNode, NodeType } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

export interface Line {
  pos: number        // position avant le nœud
  node: PMNode
  parent: number     // position de l'élément de liste qui l'imbrique, -1 au premier niveau
  list?: NodeType    // pour un élément de liste : le type de liste qui le contient
}

const LISTS = new Set(['bulletList', 'orderedList', 'taskList'])
const isList = (n: PMNode) => LISTS.has(n.type.name)
const isItem = (n: PMNode) => n.type.name === 'listItem' || n.type.name === 'taskItem'

// Toutes les lignes du document, dans l'ordre. Le premier paragraphe d'un élément de liste
// est « la ligne de l'élément », pas une ligne à part.
export function lines(doc: PMNode): Line[] {
  const out: Line[] = []
  const walk = (node: PMNode, base: number, parent: number, skipFirst: boolean) => {
    node.forEach((child, offset, index) => {
      const pos = base + offset
      if (skipFirst && index === 0) return
      if (isList(child)) walk(child, pos + 1, parent, false)
      else if (isItem(child)) {
        out.push({ pos, node: child, parent, list: node.type })
        walk(child, pos + 1, pos, true)
      } else out.push({ pos, node: child, parent })
    })
  }
  walk(doc, 0, -1, false)
  return out
}

// La ligne la plus profonde qui contient la position.
export function lineAt(ls: Line[], pos: number): Line | null {
  let found: Line | null = null
  for (const l of ls) if (l.pos <= pos && pos < l.pos + l.node.nodeSize) found = l
  return found
}

const siblings = (ls: Line[], line: Line) => ls.filter((l) => l.parent === line.parent)
const after = (l: Line) => l.pos + l.node.nodeSize

// Cibles possibles depuis la ligne sous le curseur (null = action impossible, bouton à griser).
export function targets(state: EditorState) {
  const ls = lines(state.doc)
  const line = lineAt(ls, state.selection.from)
  if (!line) return { line: null, up: null, down: null, indent: null, outdent: null }
  const sibs = siblings(ls, line)
  const i = sibs.indexOf(line)
  const parent = line.parent >= 0 ? ls.find((l) => l.pos === line.parent) ?? null : null
  const prev = i > 0 ? sibs[i - 1] : null
  const next = i < sibs.length - 1 ? sibs[i + 1] : null
  return {
    line,
    up: prev ? prev.pos : parent ? parent.pos : null,
    down: next ? after(next) : parent ? after(parent) : null,
    // Indenter : devenir le dernier enfant de la ligne précédente, si c'est un élément de liste.
    indent: prev && isItem(prev.node) ? after(prev) - 1 : null,
    // Désindenter : ressortir juste après le parent.
    outdent: parent ? after(parent) : null,
  }
}

// Supprime une ligne ; une liste qui se viderait est supprimée avec elle.
function deleteLine(tr: Transaction, line: Line) {
  const $p = tr.doc.resolve(line.pos)
  if (isList($p.parent) && $p.parent.childCount === 1) tr.delete($p.before(), $p.after())
  else tr.delete(line.pos, after(line))
}

// Insère un bloc à une position en respectant le schéma : enveloppe un élément de liste dans
// sa liste, découpe une liste pour y glisser un paragraphe, contourne le premier paragraphe
// obligatoire d'un élément. Retourne les bornes de ce qui a été inséré.
function insertBlockAt(tr: Transaction, pos: number, node: PMNode, list?: NodeType): { from: number; to: number } | null {
  const $pos = tr.doc.resolve(pos)
  const parent = $pos.parent
  const index = $pos.index()
  const candidates = [node]
  if (isItem(node) && list) candidates.push(list.create(null, node))
  for (const c of candidates) {
    if (parent.canReplaceWith(index, index, c.type)) {
      tr.insert(pos, c)
      return { from: pos, to: pos + c.nodeSize }
    }
  }
  if (isList(parent)) {
    if (index === 0) return insertBlockAt(tr, $pos.before(), node, list)
    if (index === parent.childCount) return insertBlockAt(tr, $pos.after(), node, list)
    tr.split(pos)
    return insertBlockAt(tr, pos + 1, node, list)
  }
  if (isItem(parent) && index === 0 && parent.childCount) return insertBlockAt(tr, pos + parent.child(0).nodeSize, node, list)
  return null
}

// Fusionne deux listes de même type qui se touchent à cette position.
function joinAt(tr: Transaction, pos: number) {
  if (pos < 0 || pos > tr.doc.content.size) return
  const $p = tr.doc.resolve(pos)
  const a = $p.nodeBefore
  const b = $p.nodeAfter
  if (a && b && isList(a) && isList(b) && a.type === b.type) tr.join(pos)
}

// Déplace une ligne (avec ses enfants) à une position du document d'origine, puis recolle les listes.
export function relocate(state: EditorState, line: Line, target: number): Transaction | null {
  if (target >= line.pos && target <= after(line)) return null
  const tr = state.tr
  deleteLine(tr, line)
  const afterDelete = tr.steps.length
  const delPos = tr.mapping.map(line.pos)
  const ins = insertBlockAt(tr, tr.mapping.map(target), line.node, line.list)
  if (!ins) return null
  const delNow = tr.mapping.slice(afterDelete).map(delPos)
  for (const p of [...new Set([delNow, ins.from, ins.to])].sort((a, b) => b - a)) joinAt(tr, p)
  // Le nœud déplacé est réinséré tel quel : on le retrouve par identité et on y remet le curseur
  // au même décalage qu'avant (sinon Entrée juste après un déplacement couperait la ligne avant son texte).
  let found = -1
  tr.doc.descendants((n, pos) => {
    if (found >= 0) return false
    if (n === line.node) { found = pos; return false }
    return true
  })
  if (found >= 0) {
    const offset = Math.min(Math.max(state.selection.from - line.pos, 1), line.node.nodeSize - 1)
    tr.setSelection(TextSelection.near(tr.doc.resolve(found + offset)))
  }
  return tr.scrollIntoView()
}
