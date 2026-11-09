# Design System Strategy: The Academic Atelier

## 1. Overview & Creative North Star
This design system moves beyond the "utility grid" of traditional Learning Management Systems to embrace **The Academic Atelier**. 

While inspired by the clarity of Google’s ecosystem, this system rejects the "box-inside-a-box" monotony of standard education software. Instead, it treats the interface as a series of curated, editorial layers. We achieve a premium feel through **intentional asymmetry**, **tonal depth**, and **breathable white space**. By prioritizing structural hierarchy over decorative lines, we create an environment that feels like a high-end physical workspace—clean, focused, and intellectually stimulating.

### The Creative North Star: "Structured Serenity"
The goal is to eliminate cognitive load. Every element must feel like it was placed with intent, using large typographic scales and subtle surface shifts to guide the eye, rather than rigid borders or heavy shadows.

---

## 2. Colors & Surface Philosophy
The palette utilizes the iconic primary quartet but applies them with sophisticated restraint.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders to define sections.
Boundaries must be established exclusively through background color shifts. For example, a `surface-container-low` (#f3f4f5) sidebar sitting against a `surface` (#f8f9fa) main canvas. This creates a seamless, modern flow that feels integrated rather than fragmented.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of fine paper. 
- **Base Layer:** `surface` (#f8f9fa)
- **Secondary Workspace:** `surface-container-low` (#f3f4f5)
- **Content Cards/Focus Areas:** `surface-container-lowest` (#ffffff)
- **Active/Hover Modals:** `surface-container-high` (#e7e8e9)

### Glass & Gradient Accents
To prevent a "flat" or "template" appearance, use **Glassmorphism** for floating headers or navigation bars. Use the `surface` color at 80% opacity with a `backdrop-blur` of 20px. 
**Signature Gradients:** For primary CTAs (Action buttons), apply a subtle linear gradient from `primary` (#005bbf) to `primary_container` (#1a73e8) at a 135-degree angle. This adds "soul" and depth to the interaction points.

---

## 3. Typography: Editorial Authority
We utilize **Inter** to bridge the gap between technical precision and human readability.

| Token | Size | Weight | Intent |
| :--- | :--- | :--- | :--- |
| `display-lg` | 3.5rem | 700 | Hero moments, course titles |
| `headline-md` | 1.75rem | 600 | Section headers, module names |
| `title-lg` | 1.375rem | 500 | Card titles, prominent labels |
| `body-lg` | 1rem | 400 | Primary reading material |
| `label-md` | 0.75rem | 600 | Metadata, overlines (All Caps) |

**The Typographic "Breath":** Always pair `display-lg` with significant top-margin (Spacing 16 or 20) to create an editorial "header" feel that signals the start of a new cognitive chapter.

---

## 4. Elevation & Depth: Tonal Layering
Traditional "material" shadows are replaced by **Ambient Luminosity**.

- **The Layering Principle:** Place a `surface-container-lowest` (#ffffff) card on a `surface-container-low` (#f3f4f5) background. The 2% shift in brightness is sufficient for the human eye to perceive depth without visual clutter.
- **Ambient Shadows:** For floating elements (Modals/Popovers), use a multi-layered shadow: `0px 10px 40px rgba(25, 28, 29, 0.06)`. Note the use of the `on-surface` color (#191c1d) at very low opacity to mimic natural light.
- **The "Ghost Border" Fallback:** If a border is required for high-contrast accessibility modes, use `outline-variant` (#c1c6d6) at **15% opacity**. Never use a 100% opaque border.

---

## 5. Signature Components

### Buttons & Interaction
- **Primary:** Rounded `full` (pill-shaped). Uses the signature gradient. Padding: `1.25rem` (left/right) by `0.75rem` (top/bottom).
- **Secondary:** Transparent background with a `Ghost Border`. Text color uses `primary`.
- **Tertiary:** Text-only with an underline that appears on hover, moving 2px upward to indicate life.

### The Atelier Card
- **Constraint:** No borders, no hard shadows. 
- **Style:** Background `surface-container-lowest` (#ffffff), `md` (0.75rem) corner radius.
- **Separation:** Content within the card is separated by `spacing-8` vertical gaps, never by horizontal rules/lines.

### Inputs & Forms
- **Style:** Understated. Use `surface-container-high` (#e7e8e9) as the fill color with a bottom-only `outline` (#727785) that transforms into a `primary` (#005bbf) 2px stroke on focus.
- **Micro-copy:** Labels use `label-sm` and sit 4px above the input field to maintain a tight relationship.

### Progress Indicators (Course specific)
- Instead of a standard bar, use a high-end "Thread" style. A `secondary` (#006e2a) line that is only 2px thick, but glows with a subtle `secondary_container` (#8ffa9b) shadow to indicate "energy" and completion.

---

## 6. Do’s and Don'ts

### Do
- **DO** use asymmetry. Place a large headline on the left and a small "Get Started" chip on the right with vast white space between them.
- **DO** use `surface-container` shifts for hover states. If a list item is on `surface`, its hover state should be `surface-container-low`.
- **DO** lean into the Spacing Scale. Use `spacing-12` (3rem) between major sections to let the design breathe.

### Don’t
- **DON'T** use 1px dividers. If you feel the need to separate two items, increase the vertical spacing or change the background tone of one item.
- **DON'T** use pure black (#000000). Always use `on-surface` (#191c1d) for text to maintain a premium, softened contrast.
- **DON'T** use standard "Drop Shadows." If it looks like a default plugin setting, it is wrong. Shadows must be wide, soft, and tinted.

### Accessibility Note
While we prioritize aesthetics, the contrast between `on-surface` text and all `surface` variants must remain at a minimum of 4.5:1. Use the `primary` (#005bbf) for all interactive states to ensure the "touchable" areas are always recognizable.