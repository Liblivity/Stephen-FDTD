# Wavefront Studio

An interactive 2D TMz FDTD nanopillar explorer that runs entirely in the
browser. Adjust wavelength, source amplitude, pillar refractive index, width,
length, and simulation speed while viewing the field update in real time.

## Local development

```powershell
pnpm install
pnpm run dev
```

## GitHub Pages

The repository includes `.github/workflows/pages.yml`. On GitHub, open
**Settings → Pages**, choose **GitHub Actions** as the source, and push the
`main` branch. The workflow builds and publishes the static browser version.

To verify the GitHub Pages build locally:

```powershell
pnpm run build:pages
```
