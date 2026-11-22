# Reusable website redesign prompt

Redesign my existing website in the visual style of the Beyond Pharmacy delivery workspace. Start by inspecting the actual pages, identifying who uses them and finding the primary action on each. Keep my brand, content, terminology and working flows. Build the redesign in the repository and show me a working localhost preview.

**Canvas and motion.** Use a white background with three oversized, partially cropped circles in powder blue, mint and blush. Give each circle a flat, solid fill and a slow, independent drift over 20–24 seconds. Keep text and controls still. Respect reduced-motion preferences.

**Type and layout.** Use upright DM Sans throughout. Use deep navy headings (`#162441`), slate body text (`#33445F`) and cool hairline borders (`#DBE4F1`). Aim for 40–52 px hero titles, 18–20 px section headings and 14–16 px body text. Align headings, controls and content to a shared left edge. Use compact rows, 12–16 px section gaps and subtle depth. Give each section the layout its content needs. Avoid italic fonts, nested cards, repetitive three-column grids, heavy shadows, emojis and filler copy.

**Primary action.** Put one clearly worded, working button inside each main hero, directly below the title. Give it navy text, a fine border and a 9 px corner radius. Use the following soft rainbow gradient for its fill.

```css
background: linear-gradient(100deg, #FBE5E5 0%, #DEE8F7 32%, #E3F1E6 66%, #FFF3C8 100%);
```

Keep secondary actions quiet. Give hover, keyboard focus, selected and disabled states distinct treatments.

**Hero image prompt.** “Create a wide editorial 3D illustration for the [page name] page of [business]. Show [one physical scene that communicates this page’s purpose]. Use tactile matte materials, soft daylight, an ivory base and restrained pastel accents. Compose the main objects on the right half. Leave the left 45% pale, low-detail and open for a heading and button. Keep the important objects within the middle vertical band so the image can crop into a shallow desktop banner. Render the artwork without lettering, logos, UI or buttons.”

Give the overview page a wider scene showing the service in context. Give a task page a closer view of the tools used for that task. Our delivery examples were a van on a neighborhood route and a packing counter with two parcels, a sage tray and a label printer. Choose equally specific subjects from my business. Export optimized WebP artwork and render all titles and buttons as real HTML.

**Clickable icons.** For prominent actions, generate a single recognizable 3D object with a simple silhouette, matte finish, consistent lighting and a transparent background. Crop closely and float it directly beside its label. Omit icon tiles and backplates. Keep any signature icon people already recognize. Use consistent line icons for small navigation controls.

**Review before presenting.** Build a draft, then make two refinement passes. First remove generic elements, competing accents and artwork that distracts from the primary action. Then check spacing, alignment, contrast, image crops, keyboard interaction and motion at desktop widths. Click through the main workflow. Show the final version and a brief note on what improved.
