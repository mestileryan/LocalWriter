# LocalWriter

Un Notion-like minimaliste, gratuit et pensé d'abord pour le mobile.

- **Local-first** : tout est stocké sur l'appareil (IndexedDB). Aucun compte, aucun serveur.
- **PWA** : installable sur l'écran d'accueil, fonctionne hors ligne.
- **Mobile d'abord** : barre d'outils collée au-dessus du clavier, boutons de 48 px, indentation sans touche Tab.
- **Pages imbriquées**, titres, listes, cases à cocher, citations, blocs de code.
- **Export / import** JSON pour sauvegarder ou passer d'un appareil à l'autre.

Application : https://mestileryan.github.io/LocalWriter/

## Développement

```sh
npm install
npm run dev      # serveur local
npm run build    # build de production dans dist/
npm run lint
npm run icons    # régénère les PNG de la PWA à partir de public/favicon.svg
```

Stack : Vite, React, TypeScript, [TipTap](https://tiptap.dev) (éditeur), [Dexie](https://dexie.org) (IndexedDB), vite-plugin-pwa.

Le déploiement sur GitHub Pages est automatique à chaque push sur `main` (`.github/workflows/deploy.yml`).
