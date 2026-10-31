import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/react'

export interface Page {
  id: string
  parentId: string | null
  title: string
  content: JSONContent | null
  createdAt: number
  updatedAt: number
}

export const db = new Dexie('localwriter') as Dexie & {
  pages: EntityTable<Page, 'id'>
}

db.version(1).stores({
  pages: 'id, parentId, updatedAt',
})
// v2 : tri stable par date de création (trier par updatedAt faisait sauter la page en cours de frappe en tête de liste).
db.version(2)
  .stores({ pages: 'id, parentId, createdAt' })
  .upgrade((tx) => tx.table('pages').toCollection().modify((p: Page) => { p.createdAt ??= p.updatedAt }))

export async function createPage(parentId: string | null = null): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()
  await db.pages.add({ id, parentId, title: '', content: null, createdAt: now, updatedAt: now })
  return id
}

export async function deletePage(id: string): Promise<void> {
  const ids = [id]
  for (let i = 0; i < ids.length; i++) {
    const children = await db.pages.where('parentId').equals(ids[i]).primaryKeys()
    ids.push(...children)
  }
  await db.pages.bulkDelete(ids)
}

export async function exportAll(): Promise<string> {
  return JSON.stringify(await db.pages.toArray(), null, 2)
}

export async function importAll(json: string): Promise<number> {
  const pages = JSON.parse(json) as Page[]
  if (!Array.isArray(pages) || !pages.every((p) => typeof p?.id === 'string')) throw new Error('invalid')
  await db.pages.bulkPut(pages.map((p) => ({ ...p, createdAt: p.createdAt ?? p.updatedAt ?? Date.now() })))
  return pages.length
}
