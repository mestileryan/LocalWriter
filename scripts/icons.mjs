// Génère les PNG de la PWA à partir de public/favicon.svg : `npm run icons`.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))
const svg = await readFile(pub('favicon.svg'))
// Variante « maskable » : fond plein bord, l'OS applique lui-même son masque.
const maskable = Buffer.from(svg.toString().replace('rx="96"', 'rx="0"'))

await Promise.all([
  sharp(svg).resize(192).png().toFile(pub('pwa-192.png')),
  sharp(svg).resize(512).png().toFile(pub('pwa-512.png')),
  sharp(svg).resize(180).png().toFile(pub('apple-touch-icon.png')),
  sharp(maskable).resize(512).png().toFile(pub('maskable-512.png')),
])
console.log('icônes générées')
