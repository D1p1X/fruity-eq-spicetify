# GitHub and Spicetify Marketplace — release walkthrough

Follow these steps after `npm run test` and `npm run check` pass locally.

## 1. Create the Git repository

```sh
git init -b main
git add .
git commit -m "Initial release: Fruity EQ for Spicetify"
```

## 2. Create the GitHub repository

1. Sign in to the **D1p1X** GitHub account.
2. Create a **public** repository named `fruity-eq-spicetify`.
3. Do not create GitHub's starter README, `.gitignore`, or license: this project already has all three.
4. Add the repository description: `Seven-band FL-style parametric EQ Custom App for Spicetify.`
5. Add the GitHub topics `spicetify-apps`, `spicetify`, `spotify`, `equalizer`, and `audio`.

## 3. Push the verified source

```sh
git remote add origin https://github.com/D1p1X/fruity-eq-spicetify.git
git push -u origin main
```

Open the repository page and verify all of the following are visible at the root:

1. `manifest.json`
2. `README.md`
3. `assets/eq-preview.png`
4. `.github/workflows/verify.yml`
5. The author link `D1p1X`

## 4. Verify the GitHub Action

1. Open the **Actions** tab.
2. Open the latest **Verify Fruity EQ** run.
3. Confirm `npm run check` and `npm run build:release` are both green.
4. If a check fails, fix it locally, rerun the two commands, commit, and push again.

## 5. Marketplace publication

Spicetify Marketplace discovers public GitHub repositories by topic and reads the root `manifest.json` to make the card. There is no separate binary upload for this Custom App.

1. Confirm the repository remains public.
2. Confirm the `spicetify-apps` topic is present.
3. Confirm the root manifest's `preview` is `assets/eq-preview.png` and `readme` is `README.md`.
4. Wait for Marketplace indexing; it is asynchronous.
5. In Spotify's Marketplace Custom Apps view, search for `Fruity EQ` after the index has refreshed.

## 6. Post-publication test

1. Install from the public repository in a clean Spicetify profile.
2. Confirm it does not replace existing `custom_apps` entries.
3. Test local presets, node dragging, faders, filters, A/B, global bypass, and system audio following [SYSTEM-AUDIO.md](SYSTEM-AUDIO.md).
4. Record the tested Spotify, Spicetify, OS, and Chromium versions in the GitHub release notes.

Marketplace indexing can take time. A public repository with the required topic is **submitted for discovery**, but it is not correct to claim it has appeared in Marketplace until its card is actually visible there.
