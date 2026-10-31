import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/react'

export interface Page {
  id: string
  parentId: string | null
  title: string
  content: JSONContent | null
  updatedAt: number
}

export const db = new Dexie('localwriter') as Dexie & {
  pages: EntityTable<Page, 'id'>
}

db.version(1).stores({
  pages: 'id, parentId, updatedAt',
})

export async function createPage(parentId: string | null = null): Promise<string> {
  const id = crypto.randomUUID()
  await db.pages.add({ id, parentId, title: '', content: null, updatedAt: Date.now() })
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
  await db.pages.bulkPut(pages)
  return pages.length
}
