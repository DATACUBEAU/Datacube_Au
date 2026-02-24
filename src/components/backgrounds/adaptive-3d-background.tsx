'use client';

import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';

type SceneType = 'marketing' | 'informational' | 'system' | 'productivity' | 'focus';

type BackgroundEngineConfig = {
  speed: number;
  direction: number;
  depth: number;
  particleCount: number;
  parallaxStrength: number;
  transitionMs: number;
  palette: {
    light: string[];
    dark: string[];
  };
  glowPalette: {
    light: string[];
    dark: string[];
  };
};

type Props = {
  scene: SceneType;
  disableMotion?: boolean;
};

type RGB = { r: number; g: number; b: number };

const DEFAULT_LIGHT_PALETTE = ['#f8fafc', '#e2e8f0', '#dbeafe', '#e0f2fe', '#fef9c3'];
const DEFAULT_DARK_PALETTE = ['#020617', '#0f172a', '#111827', '#0c4a6e', '#1e293b'];
const DEFAULT_LIGHT_GLOWS = ['#0ea5e9', '#2563eb', '#14b8a6', '#f59e0b'];
const DEFAULT_DARK_GLOWS = ['#38bdf8', '#60a5fa', '#22d3ee', '#facc15'];

const DEFAULT_CONFIG: Record<SceneType, BackgroundEngineConfig> = {
  marketing: {
    speed: 1.05,
    direction: 1,
    depth: 640,
    particleCount: 52,
    parallaxStrength: 22,
    transitionMs: 12000,
    palette: { light: DEFAULT_LIGHT_PALETTE, dark: DEFAULT_DARK_PALETTE },
    glowPalette: { light: DEFAULT_LIGHT_GLOWS, dark: DEFAULT_DARK_GLOWS },
  },
  informational: {
    speed: 0.92,
    direction: -1,
    depth: 520,
    particleCount: 44,
    parallaxStrength: 18,
    transitionMs: 13500,
    palette: { light: DEFAULT_LIGHT_PALETTE, dark: DEFAULT_DARK_PALETTE },
    glowPalette: { light: DEFAULT_LIGHT_GLOWS, dark: DEFAULT_DARK_GLOWS },
  },
  system: {
    speed: 0.85,
    direction: 1,
    depth: 560,
    particleCount: 40,
    parallaxStrength: 16,
    transitionMs: 14500,
    palette: { light: DEFAULT_LIGHT_PALETTE, dark: DEFAULT_DARK_PALETTE },
    glowPalette: { light: DEFAULT_LIGHT_GLOWS, dark: DEFAULT_DARK_GLOWS },
  },
  productivity: {
    speed: 1,
    direction: 1,
    depth: 600,
    particleCount: 56,
    parallaxStrength: 24,
    transitionMs: 11800,
    palette: { light: DEFAULT_LIGHT_PALETTE, dark: DEFAULT_DARK_PALETTE },
    glowPalette: { light: DEFAULT_LIGHT_GLOWS, dark: DEFAULT_DARK_GLOWS },
  },
  focus: {
    speed: 1.12,
    direction: -1,
    depth: 680,
    particleCount: 64,
    parallaxStrength: 28,
    transitionMs: 9800,
    palette: { light: DEFAULT_LIGHT_PALETTE, dark: DEFAULT_DARK_PALETTE },
    glowPalette: { light: DEFAULT_LIGHT_GLOWS, dark: DEFAULT_DARK_GLOWS },
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!/^#?[0-9a-f]{6}$/.test(value)) return null;
  return value.startsWith('#') ? value : `#${value}`;
}

function toRGB(hex: string): RGB {
  const normalized = normalizeHex(hex) || '#000000';
  const parsed = normalized.replace('#', '');
  return {
    r: Number.parseInt(parsed.slice(0, 2), 16),
    g: Number.parseInt(parsed.slice(2, 4), 16),
    b: Number.parseInt(parsed.slice(4, 6), 16),
  };
}

function toHex(rgb: RGB): string {
  const channel = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function toRgba(hex: string, alpha: number): string {
  const { r, g, b } = toRGB(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function lerpColor(a: string, b: string, t: number): string {
  const from = toRGB(a);
  const to = toRGB(b);
  return toHex({
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  });
}

function blendColor(base: string, tint: string, amount: number): string {
  return lerpColor(base, tint, clamp(amount, 0, 1));
}

function luminance(hex: string): number {
  const { r, g, b } = toRGB(hex);
  const toLinear = (c: number) => {
    const value = c / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(l1: number, l2: number): number {
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

function samplePalette(colors: string[], phase: number): string {
  if (colors.length === 0) return '#0f172a';
  if (colors.length === 1) return colors[0];
  const wrapped = ((phase % colors.length) + colors.length) % colors.length;
  const index = Math.floor(wrapped);
  const next = (index + 1) % colors.length;
  const t = wrapped - index;
  return lerpColor(colors[index], colors[next], t);
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function normalizePalette(input: unknown, fallback: string[]): string[] {
  if (!Array.isArray(input)) return fallback;
  const normalized = input
    .map((entry) => normalizeHex(entry))
    .filter((entry): entry is string => Boolean(entry));
  return normalized.length > 1 ? normalized : fallback;
}

function normalizeConfig(scene: SceneType, raw: any): BackgroundEngineConfig {
  const base = DEFAULT_CONFIG[scene];
  if (!raw || typeof raw !== 'object') return base;

  return {
    speed: clamp(Number(raw.speed ?? base.speed) || base.speed, 0.2, 4),
    direction: clamp(Number(raw.direction ?? base.direction) || base.direction, -1, 1),
    depth: clamp(Number(raw.depth ?? base.depth) || base.depth, 220, 900),
    particleCount: clamp(Math.round(Number(raw.particleCount ?? base.particleCount) || base.particleCount), 20, 120),
    parallaxStrength: clamp(Number(raw.parallaxStrength ?? base.parallaxStrength) || base.parallaxStrength, 8, 40),
    transitionMs: clamp(Number(raw.transitionMs ?? base.transitionMs) || base.transitionMs, 6000, 32000),
    palette: {
      light: normalizePalette(raw.palette?.light, base.palette.light),
      dark: normalizePalette(raw.palette?.dark, base.palette.dark),
    },
    glowPalette: {
      light: normalizePalette(raw.glowPalette?.light, base.glowPalette.light),
      dark: normalizePalette(raw.glowPalette?.dark, base.glowPalette.dark),
    },
  };
}

export function Adaptive3DBackground({ scene, disableMotion = false }: Props) {
  const { resolvedTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const shouldReduce = disableMotion || Boolean(reduceMotion);
  const themeMode = resolvedTheme === 'light' ? 'light' : 'dark';

  const [config, setConfig] = useState<BackgroundEngineConfig>(DEFAULT_CONFIG[scene]);
  const [colorState, setColorState] = useState(() => ({
    base: DEFAULT_CONFIG[scene].palette.dark[0],
    accent: DEFAULT_CONFIG[scene].glowPalette.dark[0],
    support: DEFAULT_CONFIG[scene].glowPalette.dark[1],
    overlayAlpha: 0.12,
  }));
  const pointerRef = useRef({ x: 0, y: 0 });
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  const { scrollY } = useScroll();
  const layerDriftA = useTransform(scrollY, [0, 1800], [0, 160 * config.direction]);
  const layerDriftB = useTransform(scrollY, [0, 1800], [0, -120 * config.direction]);

  useEffect(() => {
    let active = true;
    const abort = new AbortController();

    async function loadConfig() {
      try {
        const response = await fetch(`/api/background/config?scene=${scene}`, {
          method: 'GET',
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        setConfig(normalizeConfig(scene, payload));
      } catch {
      }
    }

    void loadConfig();
    return () => {
      active = false;
      abort.abort();
    };
  }, [scene]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;

    const sync = (clientX: number, clientY: number) => {
      const x = clamp((clientX / window.innerWidth - 0.5) * 2, -1, 1);
      const y = clamp((clientY / window.innerHeight - 0.5) * 2, -1, 1);
      pointerRef.current = { x, y };
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        setPointer(pointerRef.current);
        raf = 0;
      });
    };

    const onMouseMove = (event: MouseEvent) => sync(event.clientX, event.clientY);
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      sync(touch.clientX, touch.clientY);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  const particles = useMemo(() => {
    const random = seeded(scene.length * 97 + (themeMode === 'dark' ? 11 : 23));
    return Array.from({ length: config.particleCount }).map((_, index) => {
      const depth = random();
      const glowPalette = config.glowPalette[themeMode];
      const color = glowPalette[Math.floor(random() * glowPalette.length)] || glowPalette[0];
      return {
        id: `${scene}-${themeMode}-${index}`,
        x: random() * 100,
        y: random() * 100,
        size: 1 + random() * 3.2,
        depth,
        driftX: -42 + random() * 84,
        driftY: -36 + random() * 72,
        duration: 9 + random() * 14,
        delay: random() * 4,
        opacity: 0.1 + random() * 0.24,
        color,
      };
    });
  }, [config.glowPalette, config.particleCount, scene, themeMode]);

  useEffect(() => {
    const palette = config.palette[themeMode];
    const glows = config.glowPalette[themeMode];
    let frame = 0;
    let interval: number | null = null;

    const update = () => {
      const now = Date.now();
      const phase = (now / Math.max(config.transitionMs, 6000)) * config.speed;
      const base = samplePalette(palette, phase);
      const accent = samplePalette(glows, phase + 0.9);
      const support = samplePalette(glows, phase + 1.7);

      const averageLuminance = (
        luminance(base) * 0.54 +
        luminance(accent) * 0.28 +
        luminance(support) * 0.18
      );

      let overlayAlpha = 0.08;
      if (themeMode === 'dark') {
        const targetBackgroundLuminance = 0.18;
        if (averageLuminance > targetBackgroundLuminance) {
          overlayAlpha = clamp(
            (averageLuminance - targetBackgroundLuminance) / Math.max(averageLuminance, 0.0001),
            0.08,
            0.72,
          );
        }
        const adjusted = averageLuminance * (1 - overlayAlpha);
        const ratio = contrastRatio(1, adjusted);
        if (ratio < 4.5) {
          overlayAlpha = clamp(overlayAlpha + (4.5 - ratio) * 0.07, 0.1, 0.78);
        }
      } else {
        const targetBackgroundLuminance = 0.56;
        if (averageLuminance < targetBackgroundLuminance) {
          overlayAlpha = clamp(
            (targetBackgroundLuminance - averageLuminance) / Math.max(1 - averageLuminance, 0.0001),
            0.06,
            0.78,
          );
        }
        const adjusted = averageLuminance + (1 - averageLuminance) * overlayAlpha;
        const ratio = contrastRatio(adjusted, 0.08);
        if (ratio < 4.5) {
          overlayAlpha = clamp(overlayAlpha + (4.5 - ratio) * 0.08, 0.1, 0.82);
        }
      }

      setColorState({ base, accent, support, overlayAlpha });
    };

    update();
    interval = window.setInterval(update, shouldReduce ? 1200 : 150);
    return () => {
      if (interval !== null) {
        window.clearInterval(interval);
      }
      frame += 1;
    };
  }, [config.glowPalette, config.palette, config.speed, config.transitionMs, shouldReduce, themeMode]);

  const parallaxX = pointer.x * config.parallaxStrength;
  const parallaxY = pointer.y * config.parallaxStrength;
  const blendedA = blendColor(colorState.base, colorState.accent, themeMode === 'dark' ? 0.34 : 0.2);
  const blendedB = blendColor(colorState.base, colorState.support, themeMode === 'dark' ? 0.3 : 0.17);

  if (shouldReduce) {
    const staticOverlay = themeMode === 'dark'
      ? toRgba('#000000', colorState.overlayAlpha)
      : toRgba('#ffffff', colorState.overlayAlpha);

    return (
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at 18% 22%, ${toRgba(colorState.accent, 0.24)}, transparent 46%), radial-gradient(circle at 82% 78%, ${toRgba(colorState.support, 0.2)}, transparent 44%), linear-gradient(145deg, ${blendedA}, ${blendedB})`,
          }}
        />
        <div className="absolute inset-0" style={{ backgroundColor: staticOverlay }} />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden [perspective:1200px]"
      aria-hidden="true"
    >
      <motion.div
        className="absolute inset-0 transform-gpu will-change-transform"
        style={{
          y: layerDriftA,
          transform: `translate3d(${parallaxX * 0.15}px, ${parallaxY * 0.1}px, 0px)`,
          background: `radial-gradient(circle at 14% 18%, ${toRgba(colorState.accent, themeMode === 'dark' ? 0.34 : 0.24)}, transparent 42%), radial-gradient(circle at 82% 80%, ${toRgba(colorState.support, themeMode === 'dark' ? 0.28 : 0.2)}, transparent 46%), linear-gradient(145deg, ${blendedA}, ${blendedB})`,
        }}
        animate={{ opacity: [0.88, 1, 0.9] }}
        transition={{ duration: 8 / config.speed, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        className="absolute -left-20 top-[-12%] h-[46vw] w-[46vw] rounded-full blur-3xl transform-gpu will-change-transform"
        style={{
          y: layerDriftB,
          backgroundColor: toRgba(colorState.accent, themeMode === 'dark' ? 0.28 : 0.2),
          transform: `translate3d(${parallaxX * 0.5}px, ${parallaxY * 0.35}px, ${config.depth * 0.25}px)`,
        }}
        animate={{
          x: [0, 26 * config.direction, -14 * config.direction, 0],
          y: [0, -18, 12, 0],
          scale: [1, 1.08, 0.96, 1],
          opacity: [0.18, 0.34, 0.2, 0.18],
        }}
        transition={{ duration: 16 / config.speed, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        className="absolute -right-20 bottom-[-14%] h-[44vw] w-[44vw] rounded-full blur-3xl transform-gpu will-change-transform"
        style={{
          y: layerDriftA,
          backgroundColor: toRgba(colorState.support, themeMode === 'dark' ? 0.26 : 0.18),
          transform: `translate3d(${parallaxX * 0.65}px, ${parallaxY * 0.45}px, ${config.depth * 0.4}px)`,
        }}
        animate={{
          x: [0, -30 * config.direction, 16 * config.direction, 0],
          y: [0, 18, -16, 0],
          scale: [1, 1.1, 0.95, 1],
          opacity: [0.14, 0.3, 0.2, 0.14],
        }}
        transition={{ duration: 19 / config.speed, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="absolute inset-0 transform-gpu will-change-transform">
        {particles.map((particle) => (
          <motion.span
            key={particle.id}
            className="absolute rounded-full"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              backgroundColor: toRgba(particle.color, particle.opacity),
              boxShadow: `0 0 ${8 + particle.size * 2}px ${toRgba(particle.color, particle.opacity * 0.9)}`,
              transform: `translate3d(${parallaxX * particle.depth * 0.7}px, ${parallaxY * particle.depth * 0.7}px, ${(particle.depth - 0.5) * config.depth}px)`,
              willChange: 'transform, opacity',
            }}
            animate={{
              x: [0, particle.driftX * config.direction, 0],
              y: [0, particle.driftY, 0],
              opacity: [particle.opacity, particle.opacity * 1.45, particle.opacity],
              scale: [1, 1.12, 1],
            }}
            transition={{
              duration: particle.duration / config.speed,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: particle.delay,
            }}
          />
        ))}
      </div>

      <div
        className="absolute inset-0"
        style={{
          backgroundColor:
            themeMode === 'dark'
              ? toRgba('#000000', colorState.overlayAlpha)
              : toRgba('#ffffff', colorState.overlayAlpha),
          transition: 'background-color 200ms linear',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: themeMode === 'dark'
            ? 'radial-gradient(circle at 50% 12%, rgba(255,255,255,0.06), transparent 46%), radial-gradient(circle at 50% 120%, rgba(0,0,0,0.34), transparent 54%)'
            : 'radial-gradient(circle at 50% 12%, rgba(255,255,255,0.36), transparent 46%), radial-gradient(circle at 50% 120%, rgba(0,0,0,0.08), transparent 54%)',
        }}
      />
    </div>
  );
}
