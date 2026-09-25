---
version: "alpha"
name: "Cottagecore"
description: "Cottagecore visual system, translated from the Claude Artisan catalog for use in digital products. Soft floral, gingham, pastoral palettes; Mushrooms, wildflowers, baking, cottages"
colors:
  primary: "#7a8450"
  background: "#f6f0e3"
  surface: "#fffdf7"
  text: "#3f3423"
  accent: "#c1694f"
  on-primary: "#000000"
  on-surface: "#000000"
  on-accent: "#000000"
typography:
  h1:
    fontFamily: "'Playfair Display', 'Lora', Georgia, serif"
    fontSize: "4rem"
    fontWeight: "700"
    lineHeight: "1.05"
  body-md:
    fontFamily: "'Nunito', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: "400"
    lineHeight: "1.6"
  label-caps:
    fontFamily: "'Nunito', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: "600"
    letterSpacing: "0.06em"
rounded:
  sm: "6px"
  md: "12px"
  lg: "20px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "16px"
  button-secondary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    padding: "16px"
---
## Overview

Cottagecore visual system, translated from the Claude Artisan catalog for use in digital products. Soft floral, gingham, pastoral palettes; Mushrooms, wildflowers, baking, cottages

- **Category:** niche
- **Era:** 2018–present (peak 2020)
- **Origin:** Tumblr/TikTok idealized rural life.
- **Reference:** Cottagecore Tumblr; 'Anne with an E' moodboards.
- **Structural base:** hero, superfície, conteúdo e grade responsiva

**Defining traits:**
- Soft floral, gingham, pastoral palettes
- Mushrooms, wildflowers, baking, cottages
- Handwritten/serif type, warm nostalgia
- Cozy, wholesome, slow-living

## Colors

- **bg** — #f6f0e3
- **surface** — #fffdf7
- **surface-strong** — #ede2c8
- **border** — #b8a473
- **text** — #3f3423
- **text-muted** — #6b5c3f
- **primary** — #7a8450
- **accent** — #c1694f
- **gingham** — rgba(122, 132, 80, 0.16)

## Typography

- Display: 'Playfair Display', 'Lora', Georgia, serif
- Body: 'Nunito', system-ui, sans-serif
- Mono: ui-monospace, monospace

## Layout

- hero, superfície, conteúdo e grade responsiva
- Use a responsive grid and preserve content hierarchy.
- Collapse columns below 768px without horizontal overflow.

## Elevation & Depth

- Soft floral, gingham, pastoral palettes; Mushrooms, wildflowers, baking, cottages; Handwritten/serif type, warm nostalgia; Cozy, wholesome, slow-living; sombras e elevação

## Shapes

- Radius scale: 6px, 12px, 20px.

## Components

- Buttons keep visible focus and predictable hover/pressed states.
- Cards use the surface and radius scale from the tokens.
- Forms expose persistent labels, textual errors, and keyboard focus.

## Do's and Don'ts

- Do: follow the tokens and the structural composition.
- Do: maintain WCAG AA contrast and `prefers-reduced-motion`.
- Avoid: using the style as decoration without functional hierarchy.

<!-- Source: https://designmd.app/library/cottagecore · designmd.app -->
