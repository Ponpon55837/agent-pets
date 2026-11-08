# Panel themes

`contributes.panelThemes` lets a plugin restyle the Agent Pets settings/status panel and the pet's status pill: colours, fonts, font scale, corner radii and a background (solid, gradient or packaged image). Themes are data only. A themes-only plugin has no Worker, no permissions and no Host API. Requires Agent Pets 1.12.0 or later.

The authoritative contract is [docs/design/Plugin-Panel-Theme-Spec.md](../design/Plugin-Panel-Theme-Spec.md). This page is the author summary.

## Where users pick a theme

Settings → Plugins → *your plugin* → **Panel themes**. Each theme shows a light and a dark preview (including the pet status pill) and has **Use in light mode**, **Use in dark mode** and **Use for both modes**. There is one theme slot per mode for the whole app, so applying a theme replaces the one in use. Settings → General → Appearance only shows which theme each mode uses, **Open plugin settings** and **Restore built-in**.

## What you declare

```json
{
  "id": "sakura",
  "displayName": { "zh-TW": "櫻花", "en-US": "Sakura" },
  "fonts": [{ "id": "nunito", "src": "fonts/nunito-400.woff2", "weight": 400 }],
  "typography": { "body": ["@nunito", "PingFang TC", "system-ui", "sans-serif"], "scale": 1.0 },
  "shape": { "radiusSm": 8, "radiusMd": 14, "radiusLg": 24 },
  "modes": {
    "light": {
      "colors": { "bg": "#fbf1f3", "surface": "#fffafb", "surface2": "#f6e6ea", "text": "#2a1d22", "textSecondary": "#5c4750", "textMuted": "#6a5560", "accent": "#b4446a", "accentText": "#8f2f52", "onAccent": "#ffffff", "border": "rgb(42 29 34 / 0.16)" },
      "background": { "type": "image", "src": "backgrounds/sakura-light.webp", "overlay": { "color": "#fbf1f3", "opacity": 0.9 } },
      "userImage": { "allowed": true, "overlay": { "color": "#fbf1f3", "opacity": 0.9 } },
      "petStatus": { "background": "rgb(255 250 251 / 0.92)", "text": "#2a1d22" }
    },
    "dark": { "colors": { "…": "…" } }
  }
}
```

| Field | Rules |
| --- | --- |
| `id` | `^[a-z0-9-]{1,32}$`, unique, 1–8 themes per plugin |
| `displayName` / `description` | `{ "zh-TW", "en-US" }`, 1–48 / 1–120 characters |
| `fonts[]` | ≤ 4 faces, `.woff2` only (≤ 1 MiB, `wOF2` magic), `weight` 400/600/700, `style` normal/italic; ≤ 8 font files per plugin; every packaged `.woff2` must be referenced |
| `typography.body` / `.heading` | 1–5 entries: `@fontId`, a local family name (`[A-Za-z0-9 -]`, no quotes) or a generic family; the last entry must be generic |
| `typography.scale` | 0.92–1.15, at most 2 decimals; sizes never go below 11 px |
| `shape` | `radiusSm` 0–16, `radiusMd` 0–24, `radiusLg` 0–32 (integers), `Sm ≤ Md ≤ Lg` |
| `modes.light` / `modes.dark` | At least one. A single-mode theme only appears for that mode |
| `colors` | 10 required keys (`bg`, `surface`, `surface2`, `text`, `textSecondary`, `textMuted`, `accent`, `accentText`, `onAccent`, `border`) plus optional ones; see the token table in the spec §3.2 |
| `background` | `solid` (default), `gradient` (`linear` with `angle` 0–359 or `radial` with `position`; 2–5 opaque, non-decreasing stops) or `image` (package `.png`/`.webp`, `fit`, `position`, `opacity` 0.2–1, `blur` 0–24, required opaque `overlay` with `opacity` 0.5–0.95) |
| `userImage` | `{ "allowed": true, "overlay": {…}, "fit"? }` lets the user import their own background for that mode |
| `petStatus` | Pet status pill colours: `background` (alpha 0.85–1) and `text` required; `border`, `textMuted`, `quotaFill`, `quotaTrack`, `quotaWarn` optional |

Colours: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`, `hsl()/hsla()` or `oklch()` (inside sRGB). No named colours, `var()`, `calc()`, `url()` or anything else. The host re-emits every colour as `rgb(R G B / A)`; your strings never reach CSS.

## Validation (reject, never adjust)

Every mode is checked separately and any failure rejects the whole package, with a developer-mode hint such as `sakura.light.colors.textMuted: 3.92:1 < 4.5:1 on surface2`.

- Light mode needs a light `bg` (luminance ≥ 0.45) and darker text; dark mode a dark `bg` (≤ 0.12) and lighter text.
- Text, secondary, muted and accent text ≥ 4.5:1 and `accent` ≥ 3:1 on `bg`, on every gradient stop and midpoint, and on an image backdrop over a worst-case black and white pixel.
- Text levels and danger/success/warn text ≥ 4.5:1 on `surface` and `surface2`; `onAccent` ≥ 4.5:1 on `accentHover` and ≥ 3:1 on `accent`.
- Image overlays must be at least the computed minimum (and never below 0.50). The hint names the failing pair and the minimum. Reusing the built-in light text colours on an image cannot pass (`textMuted` is 4.96:1 on the built-in `bg`); pick darker text.
- The pet pill is checked over a black and a white desktop: `text` and `textMuted` ≥ 4.5:1, `quotaFill` and `quotaWarn` ≥ 3:1 on the pill and on the quota track.

Omitted optional colours are derived deterministically (spec §3.5, §3.7). `accentHover` is `accent` mixed toward `text` by the first of 0.20, 0.25 … 0.60 that keeps `onAccent` at 4.5:1.

## What stays built-in

Permission and risk prompts, the plugin install sheet, plugin content frames, confirmation dialogs, the server health banner and the theme controls themselves always use the built-in palette. In the pet window only the status pill takes theme colours; bubbles, the permission bubble, state dots, completion markers, badges and the sprite never do. The critical (< 20%) quota colour stays built-in.

## Packaging and the catalog

A package with themes is an asset package: ≤ 25 MiB and ≤ 64 files; background images ≤ 8 MiB, 64–4096 px per side, ≤ 8.39 MP, static, EXIF orientation 1; fonts ≤ 1 MiB. Catalog versions with `panelThemes` must set `"minAppVersion": "1.12.0"`; older apps hide them. Consent shows "Provide N panel themes" (low) and, with fonts, "Include custom fonts for the panel" (medium); adding themes or fonts asks again.
