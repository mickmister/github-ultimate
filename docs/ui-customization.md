# Device-local UI customization

Open **Customize appearance** in the webapp. Start with **System default**,
**Daylight**, **Midnight**, **Forest**, or **Paper**, then adjust individual
colors, typography, spacing, corner radius, control height and layout widths.
Color settings have both hex pickers and text fields for other CSS colors.
Each token's **Default** button removes its override. Custom CSS has its own
editor. **Advanced JSON and console** exposes the same complete draft as JSON.

Choosing a preset replaces the draft, including custom CSS. Individual controls
and the JSON editor edit the same draft; they do not change the active theme
until **Preview customization** or **Save customization locally**. Preview does
not save; cancel restores the saved configuration. Save, reset, export and file
import use the same controller as the console API. Export contains the active
theme, including a current preview; preview or save draft edits before exporting.

```json
{
  "format": "github-ultimate-customization",
  "version": 1,
  "name": "Compact green",
  "mode": "dark",
  "tokens": {
    "accent": "#73c7a1",
    "fontFamily": "system-ui",
    "fontSize": "15px",
    "lineHeight": "1.5",
    "radius": "4px",
    "spacing": "8px",
    "controlSize": "40px",
    "contentWidth": "1200px",
    "sidebarWidth": "16rem"
  },
  "css": "[data-ui=\"review-choice\"] { border-radius: 0; }"
}
```

Other color tokens are `background`, `surface`, `text`, `muted`, `border`,
`selected`, and `error`. Mode is `system`, `light`, or `dark`. Omitted tokens
retain application defaults. Explicit light/dark mode supplies a shared palette.
Token values are individual CSS values; custom CSS is a complete stylesheet.

```js
await uiCustomization.ready()
const theme = uiCustomization.get()
theme.tokens.accent = '#73c7a1'
await uiCustomization.preview(theme)
uiCustomization.cancelPreview()
await uiCustomization.apply(theme)
uiCustomization.export()       // Entire configuration as JSON text.
uiCustomization.download()     // ui-customization.json
await uiCustomization.import(jsonText)
await uiCustomization.reset()  // Also recovers invalid saved settings.
```

The webapp uses the approved page-storage adapter, so preferences remain local to
the selected device/host. The original extension form renderer uses the same
schema/controller, extension-local storage and a stylesheet installed inside
each Shadow Root. Its console is the extension content-script execution context.
There is no automatic cross-origin or cross-host preference synchronization;
export/import carries the same configuration between them. No WebMCP adapter is
included in this initial UI/console release.

## Styling contract and migration

`[data-ui="form"]` and `[data-ui="review-choice"]` are shared hooks in the
webapp and original renderer. The webapp additionally exposes `form-question`,
`review-workspace`, and `customization-panel`. Target these hooks rather than
generated component structure. CSS executes within the current document or
Shadow Root: `:root` and `body` selectors are document-specific, while `:host`
is shadow-specific. Component selectors work in both.

## Mobile shell colors

The mobile shell follows the active web palette: background/safe areas, toolbar,
native settings text and inputs, buttons, switches, borders and error messages.
Status-bar icon brightness follows the background. Preview, cancel, save, import,
reset and system light/dark changes update the shell too. Saved colors return when
the hosted page restores its device-local customization; before the page connects,
the shell uses the device's light/dark default palette.

The page resolves the eight semantic color variables into RGB, including named
CSS colors and custom CSS overrides of those variables. The native bridge accepts
only those concrete colors from the current main document. It does not require
fixture or page-storage approval for transient color updates. Arbitrary CSS,
typography and layout rules remain web-only. Both the hosted page and the mobile
JavaScript bundle need the shell-theme update; the bridge uses existing native
messaging and adds no native dependency.

## Migration coverage

The initial token migration covers shared colors, base typography, native
controls, review choices, page width/spacing and document/review sidebar widths.
It is not a claim that every hardcoded CSS literal has been eliminated. Custom
CSS can override other selectors while the token contract expands.

Run `pnpm customization:audit` to inventory native TSX controls and inline styles.
The two reusable ast-grep rules live in `.github/openlint/rules/ast-grep/` alongside
the existing OpenLint policy. They are advisory hints and require no OpenLint
binary. Native HTML does not automatically need replacement with Ark UI, and
runtime geometry styles should not be blindly converted to static tokens.
These rules do not inspect imperative DOM construction or all CSS literals.

Imports validate the complete version/schema, token names/values and size bounds
before replacing saved settings. Unsupported versions/fields are rejected rather
than silently discarded. Preview is in memory. Configuration writes are local;
the export contains no connection credentials, review answers or other app state.
