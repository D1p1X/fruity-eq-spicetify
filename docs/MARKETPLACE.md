# Marketplace publication checklist

Fruity EQ is packaged as a Spicetify Custom App. Spicetify Marketplace discovers public GitHub repositories with the `spicetify-apps` topic and a valid root `manifest.json`.

## Before publication

1. Make the GitHub repository public.
2. Add the GitHub topic `spicetify-apps`.
3. Keep `manifest.json`, `README.md` and `assets/eq-preview.png` at their tracked paths.
4. Push the `main` branch and allow time for Marketplace indexing.

Custom Apps still require the normal local `spicetify apply` step after installation. This is a Spicetify platform constraint.

## Release check

```sh
npm run check
npm run build:release
git status
git tag v1.0.0
git push --follow-tags
```

`dist/fruity-eq/` is a reproducible ready-to-copy Custom App folder.
