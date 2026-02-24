import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type SceneType = 'marketing' | 'informational' | 'system' | 'productivity' | 'focus';

type SceneConfig = {
  speed: number;
  direction: number;
  depth: number;
  particleCount: number;
  parallaxStrength: number;
  transitionMs: number;
  palette: { light: string[]; dark: string[] };
  glowPalette: { light: string[]; dark: string[] };
};

type EngineConfigOverrides = {
  global?: Partial<SceneConfig>;
  scenes?: Partial<Record<SceneType, Partial<SceneConfig>>>;
};

const DEFAULT_SCENE_CONFIG: Record<SceneType, SceneConfig> = {
  marketing: {
    speed: 1.05,
    direction: 1,
    depth: 640,
    particleCount: 52,
    parallaxStrength: 22,
    transitionMs: 12000,
    palette: {
      light: ['#f8fafc', '#e2e8f0', '#dbeafe', '#e0f2fe', '#fef9c3'],
      dark: ['#020617', '#0f172a', '#111827', '#0c4a6e', '#1e293b'],
    },
    glowPalette: {
      light: ['#0ea5e9', '#2563eb', '#14b8a6', '#f59e0b'],
      dark: ['#38bdf8', '#60a5fa', '#22d3ee', '#facc15'],
    },
  },
  informational: {
    speed: 0.92,
    direction: -1,
    depth: 520,
    particleCount: 44,
    parallaxStrength: 18,
    transitionMs: 13500,
    palette: {
      light: ['#f8fafc', '#e2e8f0', '#dbeafe', '#e0f2fe', '#fef9c3'],
      dark: ['#020617', '#0f172a', '#111827', '#0c4a6e', '#1e293b'],
    },
    glowPalette: {
      light: ['#0ea5e9', '#2563eb', '#14b8a6', '#f59e0b'],
      dark: ['#38bdf8', '#60a5fa', '#22d3ee', '#facc15'],
    },
  },
  system: {
    speed: 0.85,
    direction: 1,
    depth: 560,
    particleCount: 40,
    parallaxStrength: 16,
    transitionMs: 14500,
    palette: {
      light: ['#f8fafc', '#e2e8f0', '#dbeafe', '#e0f2fe', '#fef9c3'],
      dark: ['#020617', '#0f172a', '#111827', '#0c4a6e', '#1e293b'],
    },
    glowPalette: {
      light: ['#0ea5e9', '#2563eb', '#14b8a6', '#f59e0b'],
      dark: ['#38bdf8', '#60a5fa', '#22d3ee', '#facc15'],
    },
  },
  productivity: {
    speed: 1,
    direction: 1,
    depth: 600,
    particleCount: 56,
    parallaxStrength: 24,
    transitionMs: 11800,
    palette: {
      light: ['#f8fafc', '#e2e8f0', '#dbeafe', '#e0f2fe', '#fef9c3'],
      dark: ['#020617', '#0f172a', '#111827', '#0c4a6e', '#1e293b'],
    },
    glowPalette: {
      light: ['#0ea5e9', '#2563eb', '#14b8a6', '#f59e0b'],
      dark: ['#38bdf8', '#60a5fa', '#22d3ee', '#facc15'],
    },
  },
  focus: {
    speed: 1.12,
    direction: -1,
    depth: 680,
    particleCount: 64,
    parallaxStrength: 28,
    transitionMs: 9800,
    palette: {
      light: ['#f8fafc', '#e2e8f0', '#dbeafe', '#e0f2fe', '#fef9c3'],
      dark: ['#020617', '#0f172a', '#111827', '#0c4a6e', '#1e293b'],
    },
    glowPalette: {
      light: ['#0ea5e9', '#2563eb', '#14b8a6', '#f59e0b'],
      dark: ['#38bdf8', '#60a5fa', '#22d3ee', '#facc15'],
    },
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

function normalizePalette(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const palette = value
      .map((entry) => normalizeHex(entry))
      .filter((entry): entry is string => Boolean(entry));
    return palette.length > 1 ? palette : fallback;
  }

  if (typeof value === 'string') {
    const palette = value
      .split(',')
      .map((entry) => normalizeHex(entry))
      .filter((entry): entry is string => Boolean(entry));
    return palette.length > 1 ? palette : fallback;
  }

  return fallback;
}

function normalizeSceneConfig(base: SceneConfig, override?: Partial<SceneConfig>): SceneConfig {
  if (!override) return base;
  return {
    speed: clamp(Number(override.speed ?? base.speed) || base.speed, 0.2, 4),
    direction: clamp(Number(override.direction ?? base.direction) || base.direction, -1, 1),
    depth: clamp(Number(override.depth ?? base.depth) || base.depth, 220, 900),
    particleCount: clamp(Math.round(Number(override.particleCount ?? base.particleCount) || base.particleCount), 20, 120),
    parallaxStrength: clamp(Number(override.parallaxStrength ?? base.parallaxStrength) || base.parallaxStrength, 8, 40),
    transitionMs: clamp(Number(override.transitionMs ?? base.transitionMs) || base.transitionMs, 6000, 32000),
    palette: {
      light: normalizePalette(override.palette?.light, base.palette.light),
      dark: normalizePalette(override.palette?.dark, base.palette.dark),
    },
    glowPalette: {
      light: normalizePalette(override.glowPalette?.light, base.glowPalette.light),
      dark: normalizePalette(override.glowPalette?.dark, base.glowPalette.dark),
    },
  };
}

function parseEnvOverrides(): EngineConfigOverrides | null {
  const raw = process.env.BACKGROUND_ENGINE_CONFIG_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as EngineConfigOverrides;
  } catch {
    return null;
  }
}

async function loadConexOverrides(): Promise<EngineConfigOverrides | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from('au_conex_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error || !data || typeof data !== 'object') return null;

    const configBlob = (data as any).background_animation_config;
    if (configBlob && typeof configBlob === 'object') {
      return configBlob as EngineConfigOverrides;
    }

    const global: Partial<SceneConfig> = {};
    if (typeof (data as any).background_speed === 'number') global.speed = Number((data as any).background_speed);
    if (typeof (data as any).background_direction === 'number') global.direction = Number((data as any).background_direction);
    if (typeof (data as any).background_depth === 'number') global.depth = Number((data as any).background_depth);
    if (typeof (data as any).background_particle_count === 'number') global.particleCount = Number((data as any).background_particle_count);
    if (typeof (data as any).background_parallax_strength === 'number') global.parallaxStrength = Number((data as any).background_parallax_strength);
    if (typeof (data as any).background_transition_ms === 'number') global.transitionMs = Number((data as any).background_transition_ms);

    const lightPalette = normalizePalette((data as any).background_palette_light, []);
    const darkPalette = normalizePalette((data as any).background_palette_dark, []);
    const lightGlowPalette = normalizePalette((data as any).background_glow_palette_light, []);
    const darkGlowPalette = normalizePalette((data as any).background_glow_palette_dark, []);

    if (lightPalette.length > 1 || darkPalette.length > 1) {
      global.palette = {
        light: lightPalette.length > 1 ? lightPalette : undefined,
        dark: darkPalette.length > 1 ? darkPalette : undefined,
      } as any;
    }
    if (lightGlowPalette.length > 1 || darkGlowPalette.length > 1) {
      global.glowPalette = {
        light: lightGlowPalette.length > 1 ? lightGlowPalette : undefined,
        dark: darkGlowPalette.length > 1 ? darkGlowPalette : undefined,
      } as any;
    }

    if (Object.keys(global).length === 0) return null;
    return { global };
  } catch {
    return null;
  }
}

function toScene(value: string | null): SceneType {
  switch (value) {
    case 'marketing':
    case 'informational':
    case 'system':
    case 'productivity':
    case 'focus':
      return value;
    default:
      return 'system';
  }
}

export async function GET(request: NextRequest) {
  const scene = toScene(request.nextUrl.searchParams.get('scene'));
  const base = DEFAULT_SCENE_CONFIG[scene];

  const envOverrides = parseEnvOverrides();
  const conexOverrides = await loadConexOverrides();

  const globalOverride = {
    ...(envOverrides?.global || {}),
    ...(conexOverrides?.global || {}),
  } as Partial<SceneConfig>;
  const sceneOverride = {
    ...(envOverrides?.scenes?.[scene] || {}),
    ...(conexOverrides?.scenes?.[scene] || {}),
  } as Partial<SceneConfig>;

  const mergedWithGlobal = normalizeSceneConfig(base, globalOverride);
  const finalConfig = normalizeSceneConfig(mergedWithGlobal, sceneOverride);

  return NextResponse.json(
    { scene, ...finalConfig },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
