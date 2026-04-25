# Animated Background System

The app uses `BackgroundController` in `src/app/layout.tsx` to render `AnimatedBackground` behind all pages.

## Component

- File: `src/components/backgrounds/animated-background.tsx`
- Props:
  - `variant`: `default | dashboard | auth | premium`
  - `shapeSet`: `mixed | circles | rings | polygons`
  - `density`, `speed`, `opacity`, `blur`, `parallax`
  - `particleCount`, `blobCount`
  - `interactive`
  - `className`
  - `disabled`

## Theme Mapping

Colors are read from CSS variables on `:root` each render cycle and on theme changes:

- `--primary`
- `--accent`
- `--muted-foreground`
- `--border`
- `--foreground`

## Per-Page Override

Use `useBackgroundOverride` from `src/hooks/use-background-override.ts`.

```tsx
import { useBackgroundOverride } from '@/hooks/use-background-override';

export default function MyPage() {
  useBackgroundOverride({ variant: 'premium' });
  return <div>...</div>;
}
```

Disable background on a page:

```tsx
import { useBackgroundOverride } from '@/hooks/use-background-override';

export default function FullscreenEditorPage() {
  useBackgroundOverride({ disabled: true });
  return <div>...</div>;
}
```

## Variant Examples

```tsx
<AnimatedBackground variant="default" />
<AnimatedBackground variant="dashboard" density={0.9} speed={0.18} />
<AnimatedBackground variant="auth" density={0.7} opacity={0.7} />
<AnimatedBackground variant="premium" shapeSet="mixed" interactive={true} />
```

## Performance Notes

- Canvas + `requestAnimationFrame` rendering.
- Pauses when tab is hidden.
- Reduces density on mobile.
- Respects `prefers-reduced-motion` by switching to static render.
- Uses `pointer-events: none` and low z-index layering to stay behind content.
