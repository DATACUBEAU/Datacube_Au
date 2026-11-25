'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, BrainCircuit, FileText, Headphones, Menu, Network, Sigma, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const navigation = [
  { href: '/', label: 'Home' }, { href: '/features', label: 'Features' },
  { href: '/about', label: 'About' }, { href: '/policy', label: 'Policy' },
] as const;
const downloadLabel = 'Download for Android';
export const deviceNote = 'Android 8.0+ · 64-bit devices · Model downloads required';
export const offlineNote = 'Study offline after model setup. Account services and downloads need internet. Features depend on the installed model and device.';

export function PublicAuHeader({ active }: { active: '/' | '/features' }) {
  return <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur">
    <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight"><Icons.logo className="h-7 w-7 text-primary" />DataCube AU</Link>
      <nav aria-label="Main navigation" className="hidden items-center gap-7 md:flex">
        {navigation.map(item => <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined}
          className={active === item.href ? 'text-sm font-semibold text-primary' : 'text-sm text-muted-foreground hover:text-foreground'}>{item.label}</Link>)}
      </nav>
      <div className="flex items-center gap-2">
        <Button asChild className="hidden md:inline-flex"><Link href="/download">{downloadLabel}</Link></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="md:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {navigation.map(item => <DropdownMenuItem key={item.href} asChild><Link href={item.href}>{item.label}</Link></DropdownMenuItem>)}
            <DropdownMenuItem asChild><Link href="/download">{downloadLabel}</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </header>;
}

export function AuDownloadButton() {
  return <Button asChild size="lg"><Link href="/download">{downloadLabel}<ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" /></Link></Button>;
}

type Illustration = 'chat' | 'diagram' | 'notes' | 'collection' | 'practice' | 'audio' | 'offline';
const features = [
  { id: 'chat', title: 'Ask away.', description: 'Talk to AU and check the passages behind document answers.', icon: BrainCircuit },
  { id: 'diagram', title: 'Make it click.', description: 'See concepts through sketches, charts and formulas.', icon: Sigma },
  { id: 'notes', title: 'Smart Notes', description: 'Turn a textbook into notes you can revisit.', icon: BookOpen },
  { id: 'collection', title: 'Connect the dots.', description: 'Find answers across related textbooks.', icon: Network },
  { id: 'practice', title: 'Test yourself.', description: 'Practice questions and revision suggestions, not exam guarantees.', icon: FileText },
  { id: 'audio', title: 'Listen and learn.', description: 'Read aloud or listen to two-voice study conversations.', icon: Headphones },
  { id: 'offline', title: 'Study offline.', description: 'Keep learning offline with compatible downloaded models.', icon: WifiOff },
] as const satisfies ReadonlyArray<{ id: Illustration; title: string; description: string; icon: typeof BookOpen }>;

function ExampleFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="relative flex min-h-36 flex-col justify-center overflow-hidden rounded-xl border border-border/70 bg-muted/25 p-4">
    <span className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>{children}
  </div>;
}

function Example({ type }: { type: Illustration }) {
  switch (type) {
    case 'chat': return <ExampleFrame label="Example conversation"><div className="ml-auto max-w-[85%] rounded-xl bg-primary/10 px-3 py-2 text-sm">Explain this simply.</div><div className="mt-3 rounded-xl border border-border bg-card p-3 text-sm"><span className="font-semibold text-primary">AU</span><p className="mt-1">Start with the main idea, then connect it to a real example.</p></div></ExampleFrame>;
    case 'diagram': return <ExampleFrame label="Biology · Cell structure">
      <svg viewBox="0 0 270 150" role="img" aria-label="Simplified plant cell with a cell wall, nucleus and central vacuole" className="h-36 w-full">
        <rect x="18" y="16" width="164" height="116" rx="18" fill="none" stroke="currentColor" strokeWidth="3" opacity=".75"/>
        <rect x="25" y="23" width="150" height="102" rx="13" fill="#22c55e" fillOpacity=".08" stroke="#16a34a"/>
        <rect x="95" y="37" width="59" height="67" rx="20" fill="#3b82f6" fillOpacity=".12" stroke="#3b82f6"/>
        <circle cx="57" cy="65" r="20" fill="#3b82f6" fillOpacity=".16" stroke="#3b82f6" strokeWidth="2"/>
        <circle cx="57" cy="65" r="6" fill="#3b82f6"/>
        <g fill="#16a34a" fillOpacity=".28" stroke="#16a34a"><ellipse cx="59" cy="105" rx="15" ry="6"/><ellipse cx="81" cy="34" rx="13" ry="6"/></g>
        <g fill="none" stroke="currentColor" strokeWidth="1" opacity=".65"><path d="M182 27H194L204 16H260"/><path d="M154 62H194L204 68H260"/><path d="M57 85V140H204"/></g>
        <g fontSize="10" fill="currentColor"><text x="206" y="13">Cell wall</text><text x="206" y="64">Vacuole</text><text x="206" y="143">Nucleus</text></g>
      </svg>
      <p className="text-center text-xs text-muted-foreground">Parts and their relationships</p>
    </ExampleFrame>;
    case 'notes': return <ExampleFrame label="Smart Notes"><div className="space-y-2"><div className="rounded-lg border bg-card p-3"><p className="text-sm font-semibold">01 — Core concept</p><p className="mt-1 text-xs text-muted-foreground">Definition and meaning</p></div><div className="rounded-lg border bg-card p-3"><p className="text-sm font-semibold">02 — Connections</p><p className="mt-1 text-xs text-muted-foreground">How the ideas fit together</p></div></div></ExampleFrame>;
    case 'collection': return <ExampleFrame label="Collection"><div className="grid grid-cols-3 gap-2">{['Physics 001','Physics 002','Physics 003'].map(name=><div key={name} className="rounded-lg border bg-card p-2 text-center"><FileText className="mx-auto mb-1 h-5 w-5 text-primary"/><p className="text-[10px]">{name}</p></div>)}</div><div className="mx-auto h-5 w-px bg-primary/50"/><div className="rounded-lg border border-primary/30 bg-card p-2 text-center text-xs">AU · Related sources</div></ExampleFrame>;
    case 'practice': return <ExampleFrame label="Revision and practice"><div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">Practice question</p><p className="mt-2 text-sm font-medium">Why does acceleration depend on net force?</p><p className="mt-3 text-xs text-primary">Review the source and example answer</p></div></ExampleFrame>;
    case 'audio': return <ExampleFrame label="Study conversation"><div className="flex items-center gap-3"><div className="rounded-full bg-primary/10 p-3"><Headphones className="h-5 w-5 text-primary"/></div><div className="flex h-10 flex-1 items-center justify-center gap-1" aria-hidden="true">{Array.from({length:25},(_,i)=><span key={i} className="w-1 rounded-full bg-primary/65" style={{height: 8 + ((i*17)%30)}}/>)}</div></div><p className="mt-3 text-sm font-medium">AU Podcast</p><p className="text-xs text-muted-foreground">Two voices. One topic.</p></ExampleFrame>;
    case 'offline': return <ExampleFrame label="On-device models"><div className="flex items-center justify-center gap-3 rounded-lg border bg-card p-4"><WifiOff className="h-6 w-6 text-primary"/><div><p className="text-sm font-semibold">Offline study</p><p className="text-xs text-muted-foreground">After model setup</p></div></div></ExampleFrame>;
  }
}

export function AuFeatureGallery() {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {features.map(feature => <article key={feature.id} className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
      <Example type={feature.id}/><div className="flex items-start gap-2"><feature.icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><div><h3 className="font-semibold tracking-tight">{feature.title}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{feature.description}</p></div></div>
    </article>)}
  </div>;
}

export function AuHeroExample() {
  return <div className="mx-auto w-full max-w-md rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-3"><p className="font-semibold">Why does a thrown ball curve?</p><Icons.logo className="h-6 w-6 shrink-0 text-primary"/></div>
    <svg viewBox="0 0 270 125" role="img" aria-label="A ball following a curved trajectory under downward gravity" className="h-40 w-full text-primary">
      <g stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><circle cx="27" cy="54" r="8"/><path d="M27 62V89M27 89L16 109M27 89L39 109M27 67L50 56M27 70L13 80"/><path d="M57 55 Q146 -45 244 105" strokeDasharray="5 5"/><path d="M211 26V53M205 46L211 53L217 46"/><path d="M8 110H260" className="text-muted-foreground" opacity=".55"/></g>
      <circle cx="57" cy="55" r="5" fill="currentColor"/><circle cx="244" cy="105" r="5" fill="currentColor"/><text x="211" y="18" fontSize="10" textAnchor="middle" fill="currentColor">Gravity</text>
    </svg>
    <p className="text-sm leading-relaxed text-muted-foreground">Forward motion meets downward gravity.</p>
    <p className="mt-2 text-xs text-muted-foreground">Example illustration · Not to scale</p>
  </div>;
}

export function AuSubjectExamples() {
  return <div className="grid gap-4 sm:grid-cols-2">
    <ExampleFrame label="Mathematics · Quadratic">
      <svg viewBox="0 0 280 150" role="img" aria-label="Graph of y equals x squared, symmetric around the y axis" className="h-36 w-full">
        <g stroke="currentColor" opacity=".35" fill="none"><path d="M20 118H260M140 8V138"/><path d="M100 114V122M180 114V122M60 114V122M220 114V122"/></g>
        <path d="M60 22Q140 214 220 22" fill="none" stroke="#3b82f6" strokeWidth="2.5"/>
        <circle cx="140" cy="118" r="4" fill="#3b82f6"/>
        <g fill="currentColor" fontSize="11"><text x="252" y="110">x</text><text x="148" y="15">y</text><text x="150" y="132">0</text><text x="175" y="32">y = x²</text></g>
      </svg>
      <p className="text-sm font-medium">A formula you can see.</p>
    </ExampleFrame>
    <ExampleFrame label="Engineering · Feedback loop">
      <svg viewBox="0 0 280 150" role="img" aria-label="Input flows through controller and system to output, with output fed back to the controller" className="h-36 w-full">
        <g fill="none" stroke="#3b82f6" strokeWidth="1.6"><rect x="65" y="45" width="76" height="36" rx="6"/><rect x="165" y="45" width="68" height="36" rx="6"/><path d="M18 63H65M141 63H165M233 63H267M259 63V120H103V81"/><path d="M59 59L65 63L59 67M159 59L165 63L159 67M261 59L267 63L261 67M99 87L103 81L107 87"/></g>
        <g fill="currentColor" fontSize="10"><text x="10" y="54">Input</text><text x="103" y="67" textAnchor="middle">Controller</text><text x="199" y="67" textAnchor="middle">System</text><text x="264" y="52" textAnchor="end">Output</text><text x="182" y="134" textAnchor="middle">Feedback</text></g>
      </svg>
      <p className="text-sm font-medium">See how a system works.</p>
    </ExampleFrame>
  </div>;
}
