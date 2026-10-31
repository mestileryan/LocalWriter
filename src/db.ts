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

// Fichiers (images) stockés en blob, référencés dans les pages par `lw://<id>` :
// mettre du base64 dans le contenu réenregistrerait des mégaoctets à chaque frappe.
export interface FileRec {
  id: string
  type: string
  blob: Blob
}

export const db = new Dexie('localwriter') as Dexie & {
  pages: EntityTable<Page, 'id'>
  files: EntityTable<FileRec, 'id'>
}

db.version(1).stores({
  pages: 'id, parentId, updatedAt',
})
// v2 : tri stable par date de création (trier par updatedAt faisait sauter la page en cours de frappe en tête de liste).
db.version(2)
  .stores({ pages: 'id, parentId, createdAt' })
  .upgrade((tx) => tx.table('pages').toCollection().modify((p: Page) => { p.createdAt ??= p.updatedAt }))
// v3 : table des fichiers.
db.version(3).stores({ pages: 'id, parentId, createdAt', files: 'id' })

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

export async function putFile(blob: Blob): Promise<string> {
  const id = crypto.randomUUID()
  await db.files.add({ id, type: blob.type, blob })
  return id
}

// Export : { version, pages, files[] } avec les fichiers en data URL.
interface Backup { version: 2; pages: Page[]; files: { id: string; type: string; data: string }[] }

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result as string)
  r.onerror = () => reject(r.error)
  r.readAsDataURL(blob)
})

export async function exportAll(): Promise<string> {
  const pages = await db.pages.toArray()
  const files = await Promise.all((await db.files.toArray()).map(async (f) => ({ id: f.id, type: f.type, data: await toDataUrl(f.blob) })))
  const backup: Backup = { version: 2, pages, files }
  return JSON.stringify(backup)
}

export async function importAll(json: string): Promise<number> {
  const raw = JSON.parse(json) as Backup | Page[]
  // Ancien format : un simple tableau de pages.
  const pages = Array.isArray(raw) ? raw : raw.pages
  const files = Array.isArray(raw) ? [] : raw.files ?? []
  if (!Array.isArray(pages) || !pages.every((p) => typeof p?.id === 'string')) throw new Error('invalid')
  await db.pages.bulkPut(pages.map((p) => ({ ...p, createdAt: p.createdAt ?? p.updatedAt ?? Date.now() })))
  const recs = await Promise.all(files.map(async (f) => ({ id: f.id, type: f.type, blob: await (await fetch(f.data)).blob() })))
  await db.files.bulkPut(recs)
  return pages.length
}
