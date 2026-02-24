'use client';

import { useReducedMotion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';

export type AnimatedBackgroundVariant = 'default' | 'dashboard' | 'auth' | 'premium';
export type AnimatedBackgroundShapeSet = 'mixed' | 'circles' | 'rings' | 'polygons';

type AnimatedBackgroundProps = {
  variant?: AnimatedBackgroundVariant;
  shapeSet?: AnimatedBackgroundShapeSet;
  density?: number;
  speed?: number;
  opacity?: number;
  blur?: number;
  parallax?: number;
  particleCount?: number;
  blobCount?: number;
  interactive?: boolean;
  className?: string;
  disabled?: boolean;
};

type Rgb = { r: number; g: number; b: number };
type NodePoint = { x: number; y: number; vx: number; vy: number; radius: number; pulseOffset: number };
type Particle = { x: number; y: number; vx: number; vy: number; size: number; alpha: number };
type Blob = { x: number; y: number; vx: number; vy: number; radius: number; alpha: number; hueShift: number };
type ShapeKind = 'circle' | 'square' | 'hex' | 'ring';
type Shape = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  alpha: number;
  kind: ShapeKind;
};

type VariantPreset = {
  nodes: number;
  particles: number;
  blobs: number;
  shapes: number;
  lineDistance: number;
  speed: number;
  opacity: number;
  blur: number;
  parallax: number;
};

const VARIANT_PRESETS: Record<AnimatedBackgroundVariant, VariantPreset> = {
  default: {
    nodes: 22,
    particles: 30,
    blobs: 2,
    shapes: 10,
    lineDistance: 130,
    speed: 0.24,
    opacity: 0.9,
    blur: 0.2,
    parallax: 0.6,
  },
  dashboard: {
    nodes: 26,
    particles: 34,
    blobs: 1,
    shapes: 8,
    lineDistance: 120,
    speed: 0.2,
    opacity: 0.85,
    blur: 0.15,
    parallax: 0.45,
  },
  auth: {
    nodes: 14,
    particles: 14,
    blobs: 1,
    shapes: 5,
    lineDistance: 100,
    speed: 0.14,
    opacity: 0.75,
    blur: 0.1,
    parallax: 0.3,
  },
  premium: {
    nodes: 32,
    particles: 48,
    blobs: 3,
    shapes: 16,
    lineDistance: 150,
    speed: 0.28,
    opacity: 0.95,
    blur: 0.25,
    parallax: 0.75,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function parseHslChannels(value: string): { h: number; s: number; l: number } | null {
  const normalized = value.replace(/\//g, ' ').trim();
  const match = normalized.match(
    /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/,
  );
  if (!match) return null;

  const h = Number.parseFloat(match[1]);
  const s = Number.parseFloat(match[2]);
  const l = Number.parseFloat(match[3]);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    return null;
  }

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = clamp(s / 100, 0, 1);
  const lig = clamp(l / 100, 0, 1);

  if (sat === 0) {
    const gray = Math.round(lig * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;

  const toChannel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };

  return {
    r: Math.round(toChannel(hue + 1 / 3) * 255),
    g: Math.round(toChannel(hue) * 255),
    b: Math.round(toChannel(hue - 1 / 3) * 255),
  };
}

function readCssRgb(
  style: CSSStyleDeclaration,
  variableName: string,
  fallback: { h: number; s: number; l: number },
): Rgb {
  const raw = style.getPropertyValue(variableName).trim();
  const channels = parseHslChannels(raw);
  if (!channels) return hslToRgb(fallback.h, fallback.s, fallback.l);
  return hslToRgb(channels.h, channels.s, channels.l);
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(alpha, 0, 1)})`;
}

function pickShapeKind(shapeSet: AnimatedBackgroundShapeSet): ShapeKind {
  if (shapeSet === 'circles') return 'circle';
  if (shapeSet === 'rings') return 'ring';
  if (shapeSet === 'polygons') {
    return Math.random() > 0.5 ? 'square' : 'hex';
  }

  const roll = Math.random();
  if (roll < 0.35) return 'circle';
  if (roll < 0.55) return 'ring';
  if (roll < 0.78) return 'square';
  return 'hex';
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape) {
  const half = shape.size / 2;

  ctx.save();
  ctx.translate(shape.x, shape.y);
  ctx.rotate(shape.rotation);

  if (shape.kind === 'circle' || shape.kind === 'ring') {
    ctx.beginPath();
    ctx.arc(0, 0, half, 0, Math.PI * 2);
    ctx.stroke();
    if (shape.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, half * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (shape.kind === 'square') {
    ctx.beginPath();
    ctx.rect(-half, -half, shape.size, shape.size);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // hex
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i;
    const px = Math.cos(angle) * half;
    const py = Math.sin(angle) * half;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function moveWrapped<T extends { x: number; y: number; vx: number; vy: number }>(
  obj: T,
  width: number,
  height: number,
  dtScale: number,
  margin = 60,
) {
  obj.x += obj.vx * dtScale;
  obj.y += obj.vy * dtScale;

  if (obj.x < -margin) obj.x = width + margin;
  if (obj.x > width + margin) obj.x = -margin;
  if (obj.y < -margin) obj.y = height + margin;
  if (obj.y > height + margin) obj.y = -margin;
}

export function AnimatedBackground({
  variant = 'default',
  shapeSet = 'mixed',
  density = 1,
  speed,
  opacity,
  blur,
  parallax,
  particleCount,
  blobCount,
  interactive = false,
  className,
  disabled = false,
}: AnimatedBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { resolvedTheme } = useTheme();
  const reduceMotion = useReducedMotion();

  const settings = useMemo(() => {
    const preset = VARIANT_PRESETS[variant];
    return {
      nodes: preset.nodes,
      particles: particleCount ?? preset.particles,
      blobs: blobCount ?? preset.blobs,
      shapes: preset.shapes,
      lineDistance: preset.lineDistance,
      speed: clamp(speed ?? preset.speed, 0.05, 1.2),
      opacity: clamp(opacity ?? preset.opacity, 0.2, 1.2),
      blur: clamp(blur ?? preset.blur, 0, 2.5),
      parallax: clamp(parallax ?? preset.parallax, 0, 1.4),
      density: clamp(density, 0.2, 2),
    };
  }, [variant, particleCount, blobCount, speed, opacity, blur, parallax, density]);

  useEffect(() => {
    if (disabled || typeof window === 'undefined') {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;

    const shouldReduceMotion = Boolean(reduceMotion);
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    const densityScale = () => (mobileQuery.matches ? 0.55 : 1);

    const nodes: NodePoint[] = [];
    const particles: Particle[] = [];
    const blobs: Blob[] = [];
    const shapes: Shape[] = [];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    let palette = {
      line: 'rgba(0,0,0,0.1)',
      node: 'rgba(0,0,0,0.2)',
      nodePulse: 'rgba(0,0,0,0.18)',
      particle: 'rgba(0,0,0,0.12)',
      shapeStroke: 'rgba(0,0,0,0.15)',
      shapeFill: 'rgba(0,0,0,0.06)',
      blobA: 'rgba(0,0,0,0.05)',
      blobB: 'rgba(0,0,0,0.04)',
      ring: 'rgba(0,0,0,0.08)',
    };

    let width = 0;
    let height = 0;
    let frameId = 0;
    let isRunning = false;
    let lastTs = 0;

    const readPalette = () => {
      const style = window.getComputedStyle(document.documentElement);
      const primary = readCssRgb(style, '--primary', { h: 220, s: 90, l: 55 });
      const accent = readCssRgb(style, '--accent', { h: 220, s: 18, l: 44 });
      const muted = readCssRgb(style, '--muted-foreground', { h: 220, s: 12, l: 56 });
      const border = readCssRgb(style, '--border', { h: 220, s: 14, l: 72 });
      const fg = readCssRgb(style, '--foreground', { h: 220, s: 16, l: 20 });
      const themeBoost = resolvedTheme === 'dark' ? 1.12 : 0.94;
      const baseOpacity = settings.opacity * themeBoost;

      palette = {
        line: rgba(border, 0.16 * baseOpacity),
        node: rgba(primary, 0.3 * baseOpacity),
        nodePulse: rgba(primary, 0.2 * baseOpacity),
        particle: rgba(muted, 0.24 * baseOpacity),
        shapeStroke: rgba(primary, 0.24 * baseOpacity),
        shapeFill: rgba(accent, 0.08 * baseOpacity),
        blobA: rgba(primary, 0.07 * baseOpacity),
        blobB: rgba(accent, 0.06 * baseOpacity),
        ring: rgba(fg, 0.08 * baseOpacity),
      };
    };

    const rebuildScene = () => {
      nodes.length = 0;
      particles.length = 0;
      blobs.length = 0;
      shapes.length = 0;

      const scaledDensity = settings.density * densityScale();
      const nodeCount = Math.max(6, Math.round(settings.nodes * scaledDensity));
      const shapeCount = Math.max(2, Math.round(settings.shapes * scaledDensity));
      const particleDensityCount = Math.max(8, Math.round(settings.particles * scaledDensity));
      const blobDensityCount = Math.max(1, Math.round(settings.blobs * scaledDensity));

      for (let i = 0; i < nodeCount; i += 1) {
        nodes.push({
          x: rand(0, width),
          y: rand(0, height),
          vx: rand(-0.18, 0.18) * settings.speed,
          vy: rand(-0.18, 0.18) * settings.speed,
          radius: rand(1.1, 2.4),
          pulseOffset: rand(0, Math.PI * 2),
        });
      }

      for (let i = 0; i < particleDensityCount; i += 1) {
        particles.push({
          x: rand(0, width),
          y: rand(0, height),
          vx: rand(-0.12, 0.12) * settings.speed,
          vy: rand(-0.12, 0.12) * settings.speed,
          size: rand(0.7, 1.8),
          alpha: rand(0.12, 0.42),
        });
      }

      for (let i = 0; i < blobDensityCount; i += 1) {
        blobs.push({
          x: rand(0, width),
          y: rand(0, height),
          vx: rand(-0.06, 0.06) * settings.speed,
          vy: rand(-0.06, 0.06) * settings.speed,
          radius: rand(120, 260),
          alpha: rand(0.25, 0.5),
          hueShift: Math.random(),
        });
      }

      for (let i = 0; i < shapeCount; i += 1) {
        shapes.push({
          x: rand(0, width),
          y: rand(0, height),
          vx: rand(-0.09, 0.09) * settings.speed,
          vy: rand(-0.09, 0.09) * settings.speed,
          size: rand(18, 52),
          rotation: rand(0, Math.PI * 2),
          rotationSpeed: rand(-0.0025, 0.0025) * settings.speed,
          alpha: rand(0.2, 0.65),
          kind: pickShapeKind(shapeSet),
        });
      }
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readPalette();
      rebuildScene();
    };

    const render = (timestamp: number) => {
      if (!isRunning) return;
      const dt = lastTs ? clamp((timestamp - lastTs) / 16.6667, 0.3, 2.1) : 1;
      lastTs = timestamp;

      const blurPx = settings.blur * 0.4;
      canvas.style.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';

      ctx.clearRect(0, 0, width, height);

      const parallaxStrength = settings.parallax * (interactive ? 18 : 8);
      pointer.x += (pointer.tx - pointer.x) * 0.08;
      pointer.y += (pointer.ty - pointer.y) * 0.08;
      const px = pointer.x * parallaxStrength;
      const py = pointer.y * parallaxStrength;

      // Soft localized blobs.
      for (const blob of blobs) {
        if (!shouldReduceMotion) {
          moveWrapped(blob, width, height, dt, blob.radius + 40);
        }
        const gx = blob.x + px * 0.18;
        const gy = blob.y + py * 0.18;
        const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, blob.radius);
        const base = blob.hueShift > 0.5 ? palette.blobA : palette.blobB;
        gradient.addColorStop(0, base);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.globalAlpha = blob.alpha * settings.opacity * 0.7;
        ctx.beginPath();
        ctx.arc(gx, gy, blob.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // Mesh lines.
      const maxDistance = settings.lineDistance;
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        if (!shouldReduceMotion) moveWrapped(a, width, height, dt, 24);

        const ax = a.x + px * 0.35;
        const ay = a.y + py * 0.35;

        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const bx = b.x + px * 0.42;
          const by = b.y + py * 0.42;
          const dx = bx - ax;
          const dy = by - ay;
          const distance = Math.hypot(dx, dy);
          if (distance > maxDistance) continue;

          const alpha = (1 - distance / maxDistance) * 0.85;
          ctx.strokeStyle = palette.line.replace(/[\d.]+\)$/g, `${clamp(alpha, 0.04, 0.35)})`);
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }

      // Nodes and gentle pulse.
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const nx = node.x + px * 0.35;
        const ny = node.y + py * 0.35;
        const pulse = shouldReduceMotion ? 0 : (Math.sin(timestamp * 0.0014 + node.pulseOffset) + 1) * 0.5;
        const radius = node.radius + pulse * 0.65;
        ctx.fillStyle = palette.node;
        ctx.beginPath();
        ctx.arc(nx, ny, radius, 0, Math.PI * 2);
        ctx.fill();

        if (variant === 'premium' && pulse > 0.8) {
          ctx.strokeStyle = palette.nodePulse;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(nx, ny, radius + 2.2 + pulse * 1.4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Particles.
      for (const particle of particles) {
        if (!shouldReduceMotion) moveWrapped(particle, width, height, dt, 12);
        const pxp = particle.x + px * 0.56;
        const pyp = particle.y + py * 0.56;
        ctx.fillStyle = palette.particle.replace(/[\d.]+\)$/g, `${clamp(particle.alpha, 0.08, 0.5)})`);
        ctx.beginPath();
        ctx.arc(pxp, pyp, particle.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Geometric layer.
      ctx.lineWidth = 1;
      for (const shape of shapes) {
        if (!shouldReduceMotion) {
          moveWrapped(shape, width, height, dt, 40);
          shape.rotation += shape.rotationSpeed * dt;
        }
        const sx = shape.x + px * 0.24;
        const sy = shape.y + py * 0.24;
        const alpha = clamp(shape.alpha * settings.opacity, 0.05, 0.45);
        ctx.strokeStyle = palette.shapeStroke.replace(/[\d.]+\)$/g, `${alpha})`);
        ctx.fillStyle = palette.shapeFill.replace(/[\d.]+\)$/g, `${alpha * 0.45})`);
        drawShape(ctx, { ...shape, x: sx, y: sy });
      }

      frameId = window.requestAnimationFrame(render);
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);
      for (const blob of blobs) {
        const gradient = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.radius);
        const base = blob.hueShift > 0.5 ? palette.blobA : palette.blobB;
        gradient.addColorStop(0, base);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.globalAlpha = blob.alpha * settings.opacity * 0.65;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const distance = Math.hypot(b.x - a.x, b.y - a.y);
          if (distance > settings.lineDistance * 0.75) continue;
          const alpha = (1 - distance / (settings.lineDistance * 0.75)) * 0.22;
          ctx.strokeStyle = palette.line.replace(/[\d.]+\)$/g, `${clamp(alpha, 0.03, 0.22)})`);
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const node of nodes) {
        ctx.fillStyle = palette.node;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const start = () => {
      if (isRunning || shouldReduceMotion) return;
      isRunning = true;
      frameId = window.requestAnimationFrame(render);
    };

    const stop = () => {
      isRunning = false;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };

    const onPointerMove = (event: MouseEvent) => {
      if (!interactive) return;
      pointer.tx = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      pointer.ty = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else if (!shouldReduceMotion) {
        start();
      }
    };

    resize();

    if (shouldReduceMotion) {
      drawStatic();
    } else {
      start();
    }

    const observer = new MutationObserver(() => {
      readPalette();
      if (shouldReduceMotion) drawStatic();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    const onResize = () => {
      resize();
      if (shouldReduceMotion) drawStatic();
    };

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('mousemove', onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    disabled,
    interactive,
    reduceMotion,
    resolvedTheme,
    settings.blur,
    settings.density,
    settings.lineDistance,
    settings.nodes,
    settings.opacity,
    settings.parallax,
    settings.particles,
    settings.shapes,
    settings.speed,
    settings.blobs,
    shapeSet,
    variant,
  ]);

  if (disabled) return null;

  return (
    <div className={cn('fixed inset-0 z-0 pointer-events-none overflow-hidden', className)} aria-hidden="true">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full transform-gpu will-change-transform" />
    </div>
  );
}
