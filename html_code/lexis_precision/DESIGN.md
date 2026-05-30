---
name: Lexis Precision
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#44474c'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#74777d'
  outline-variant: '#c4c6cd'
  surface-tint: '#4f6073'
  primary: '#041627'
  on-primary: '#ffffff'
  primary-container: '#1a2b3c'
  on-primary-container: '#8192a7'
  inverse-primary: '#b7c8de'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#211200'
  on-tertiary: '#ffffff'
  tertiary-container: '#38260b'
  on-tertiary-container: '#a88c69'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d2e4fb'
  primary-fixed-dim: '#b7c8de'
  on-primary-fixed: '#0b1d2d'
  on-primary-fixed-variant: '#38485a'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#feddb5'
  tertiary-fixed-dim: '#e1c29b'
  on-tertiary-fixed: '#281802'
  on-tertiary-fixed-variant: '#584326'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-sm:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 12px
  sidebar-width: 240px
  metadata-panel: 320px
---

## Brand & Style

The design system is engineered for the high-stakes environment of legal and enterprise contract management. The brand personality is **authoritative, analytical, and unwavering**. It prioritizes the "Intelligence" aspect of the product by using a clean, structured aesthetic that reduces cognitive load during complex document reviews.

The visual style is **Corporate Modern with a focus on Information Density**. It utilizes a systematic approach to whitespace—enough to ensure clarity, but compact enough to facilitate the side-by-side comparison of multi-page legal documents. The UI should feel like a high-performance tool: precise, responsive, and deeply reliable.

## Colors

The palette is anchored by **Deep Navy (#1A2B3C)**, which signals security and institutional trust. This color is reserved for primary actions, navigation sidebars, and critical headers. 

**Slate Gray** serves as the secondary foundation, used for metadata, borders, and icon states to prevent visual fatigue. Semantic colors (Success, Warning, Error) are vibrant but maintain enough value contrast to be accessible within dense data tables. Surfaces follow a "Paper & Ink" philosophy: pure white for document canvases and subtle off-white (`#F8FAFC`) for the application background to delineate the workspace.

## Typography

This design system utilizes **Inter** for its exceptional legibility in technical contexts. The scale is intentionally tight, favoring smaller increments to accommodate data-heavy layouts. 

- **Display & Headlines:** Use Semi-Bold weights with slight negative letter-spacing to maintain a professional, compact appearance.
- **Body Text:** Standard contract text uses `body-md` (14px) for optimal reading balance. 
- **Data & Labels:** `label-md` uses uppercase styling for field headers in metadata forms. 
- **Monospace:** `mono-md` (using JetBrains Mono or similar) is introduced specifically for clause IDs, version hashes, and technical metadata to distinguish them from natural language.

## Layout & Spacing

The layout utilizes a **hybrid split-pane model**. The primary navigation is a fixed left sidebar, while the main content area supports dynamic resizing between a "List View" (for contract repositories) and a "Comparison View" (two documents side-by-side).

A **4px base unit** governs the spacing scale, emphasizing vertical compactness. In data tables, row heights are minimized to 40px to maximize the number of visible records. Internal padding within cards and panels should default to `md` (16px), but reduces to `sm` (8px) within functional toolbars and metadata inspectors to keep essential controls "above the fold."

## Elevation & Depth

To maintain a clean, professional "software-as-a-tool" feel, this design system avoids heavy shadows. Instead, it uses **Tonal Layering and Low-Contrast Outlines**:

- **Level 0 (Background):** `#F8FAFC` - The foundational application canvas.
- **Level 1 (Cards/Panels):** Pure White with a 1px border of Slate-200. This is the primary surface for lists and editors.
- **Level 2 (Popovers/Dropdowns):** Pure White with a subtle, tight shadow (0px 4px 12px rgba(0,0,0,0.08)) and a 1px border.
- **Active State:** Elements being dragged or high-priority modals use a slightly deeper shadow to indicate focus, but never lose their crisp 1px border.

## Shapes

The shape language is **Soft (0.25rem/4px)**. This radius provides a subtle modern touch without compromising the professional, serious architectural feel of an enterprise solution. 

- **Buttons & Inputs:** 4px radius.
- **Status Chips:** Full pill-shape to distinguish them immediately from interactive buttons.
- **Data Table Rows:** Sharp corners to ensure a seamless grid appearance, with rounding applied only to the outermost container of the table.

## Components

### High-Density Data Tables
Rows must support a "Compact" mode. Column headers use `label-md` typography. Zebra-striping is used only on hover to identify the active record. Include pinned columns for "Contract Title" and "Status."

### Split-Pane Layout
A central divider that is draggable. The left pane typically houses the document viewer (PDF/OCR), while the right pane houses the "AI Insights" or "Metadata Form."

### Metadata Forms
Input fields use a "filled" style with a bottom-only border or a light gray background to ensure they are easily scannable. Error states must include both a red border and an inline icon for accessibility.

### Approval Progress Trackers
Vertical or horizontal steppers that use Navy for completed steps, Amber for pending, and Slate for future steps. Each step includes a timestamp and the actor's name.

### Dashboard Widgets
Modular tiles for analytics. Use simplified Sparklines for contract volume and Donut charts for "Contract Type" distribution. Widgets should use the same `Level 1` elevation as the document cards.