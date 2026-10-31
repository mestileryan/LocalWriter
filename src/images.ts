import { db, putFile } from './db'

const MAX_SIDE = 1600
const urls = new Map<string, string>()

// `lw://<id>` → URL d'objet (mise en cache pour la session) ; toute autre source est renvoyée telle quelle.
export async function resolveSrc(src: string): Promise<string> {
  if (!src.startsWith('lw://')) return src
  const id = src.slice(5)
  const cached = urls.get(id)
  if (cached) return cached
  const f = await db.files.get(id)
  if (!f) return ''
  const url = URL.createObjectURL(f.blob)
  urls.set(id, url)
  return url
}

// Réduit l'image (photos de téléphone : 12 Mpx) puis la stocke ; retourne la source `lw://…`.
export async function storeImage(file: File): Promise<string> {
  const blob = await downscale(file)
  return `lw://${await putFile(blob)}`
}

async function downscale(file: File): Promise<Blob> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    return file
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  if (scale === 1 && file.size < 400_000) { bmp.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), type, 0.85))
}
