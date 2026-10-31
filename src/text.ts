import type { JSONContent } from '@tiptap/react'

// Texte brut d'un document TipTap, blocs séparés par des espaces.
export function plainText(content: JSONContent | null): string {
  if (!content) return ''
  const parts: string[] = []
  const walk = (n: JSONContent) => {
    if (n.text) parts.push(n.text)
    n.content?.forEach(walk)
    if (n.type === 'paragraph' || n.type === 'heading') parts.push(' ')
  }
  walk(content)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

// Minuscules sans accents, caractère par caractère pour garder les mêmes index que la chaîne d'origine.
export function norm(s: string): string {
  let out = ''
  for (const c of s) out += c.normalize('NFD')[0].toLowerCase()
  return out
}
