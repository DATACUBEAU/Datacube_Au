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
  { id: 'chat', title: 'Ask anything. Understand the source.', description: 'Chat with AU, explore your textbooks and inspect the supporting passages.', icon: BrainCircuit },
  { id: 'diagram', title: 'See the idea.', description: 'Explore labelled sketches, flowcharts, charts and formula explanations when they help.', icon: Sigma },
  { id: 'notes', title: 'Smart Notes', description: 'Generate structured notes, revisit saved explanations and explore concept relationships.', icon: BookOpen },
  { id: 'collection', title: 'Connect the dots.', description: 'Search related documents in a collection and keep track of their sources.', icon: Network },
  { id: 'practice', title: 'Prepare with purpose.', description: 'Generate practice questions and evidence-based revision priorities, not guaranteed exam questions.', icon: FileText },
  { id: 'audio', title: 'Listen and learn.', description: 'Read answers aloud or create two-speaker study discussions with installed voices.', icon: Headphones },
  { id: 'offline', title: 'Study offline.', description: 'Use compatible downloaded models on your Android device, without a cloud inference subscription.', icon: WifiOff },
] as const satisfies ReadonlyArray<{ id: Illustration; title: string; description: string; icon: typeof BookOpen }>;

function ExampleFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="relative flex min-h-36 flex-col justify-center overflow-hidden rounded-xl border border-border/70 bg-muted/25 p-4">
    <span className="mb-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{label}</span>{children}
  </div>;
}

function Example({ type }: { type: Illustration }) {
  switch (type) {
    case 'chat': return <ExampleFrame label="Example conversation"><div className="ml-auto max-w-[85%] rounded-xl bg-primary/10 px-3 py-2 text-sm">Explain this simply.</div><div className="mt-3 rounded-xl border border-border bg-card p-3 text-sm"><span className="font-semibold text-primary">AU</span><p className="mt-1">Start with the main idea, then connect it to a real example.</p></div></ExampleFrame>;
    case 'diagram': return <ExampleFrame label="Illustrated explanation"><svg viewBox="0 0 270 118" role="img" aria-label="Conceptual ball trajectory under gravity" className="h-28 w-full text-primary"><g stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><circle cx="27" cy="54" r="8"/><path d="M27 62V89M27 89L16 109M27 89L39 109M27 67L50 56M27 70L13 80"/><path d="M57 55 Q146 -45 244 105" strokeDasharray="5 5"/><path d="M211 26V53M205 46L211 53L217 46"/><path d="M8 110H260" className="text-muted-foreground" opacity=".55"/></g><circle cx="57" cy="55" r="5" fill="currentColor"/><circle cx="145" cy="18" r="5" fill="currentColor"/><circle cx="244" cy="105" r="5" fill="currentColor"/><text x="211" y="18" fontSize="10" textAnchor="middle" fill="currentColor">Gravity</text></svg><p className="text-center text-xs text-muted-foreground">Conceptual sketch · Not to scale</p></ExampleFrame>;
    case 'notes': return <ExampleFrame label="Smart Notes"><div className="space-y-2"><div className="rounded-lg border bg-card p-3"><p className="text-sm font-semibold">01 — Core concept</p><p className="mt-1 text-xs text-muted-foreground">Definition and meaning</p></div><div className="rounded-lg border bg-card p-3"><p className="text-sm font-semibold">02 — Connections</p><p className="mt-1 text-xs text-muted-foreground">How the ideas fit together</p></div></div></ExampleFrame>;
    case 'collection': return <ExampleFrame label="Collection"><div className="grid grid-cols-3 gap-2">{['Physics 001','Physics 002','Physics 003'].map(name=><div key={name} className="rounded-lg border bg-card p-2 text-center"><FileText className="mx-auto mb-1 h-5 w-5 text-primary"/><p className="text-[10px]">{name}</p></div>)}</div><div className="mx-auto h-5 w-px bg-primary/50"/><div className="rounded-lg border border-primary/30 bg-card p-2 text-center text-xs">AU · Related sources</div></ExampleFrame>;
    case 'practice': return <ExampleFrame label="Revision and practice"><div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">Practice question</p><p className="mt-2 text-sm font-medium">Why does acceleration depend on net force?</p><p className="mt-3 text-xs text-primary">Review the source and example answer</p></div></ExampleFrame>;
    case 'audio': return <ExampleFrame label="Study conversation"><div className="flex items-center gap-3"><div className="rounded-full bg-primary/10 p-3"><Headphones className="h-5 w-5 text-primary"/></div><div className="flex h-10 flex-1 items-center justify-center gap-1" aria-hidden="true">{Array.from({length:25},(_,i)=><span key={i} className="w-1 rounded-full bg-primary/65" style={{height: 8 + ((i*17)%30)}}/>)}</div></div><p className="mt-3 text-sm font-medium">AU Podcast</p><p className="text-xs text-muted-foreground">Two voices. One topic.</p></ExampleFrame>;
    case 'offline': return <ExampleFrame label="On-device models"><div className="flex items-center justify-center gap-3 rounded-lg border bg-card p-4"><WifiOff className="h-6 w-6 text-primary"/><div><p className="text-sm font-semibold">Offline study</p><p className="text-xs text-muted-foreground">After model setup</p></div></div></ExampleFrame>;
  }
}

export function AuFeatureGallery({ compact = false }: { compact?: boolean }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {(compact ? features.slice(0,6) : features).map(feature => <article key={feature.id} className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4 sm:p-5">
      <Example type={feature.id}/><div className="flex items-start gap-2"><feature.icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><div><h3 className="font-semibold tracking-tight">{feature.title}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{feature.description}</p></div></div>
    </article>)}
  </div>;
}

export function AuHeroExample() {
  return <div className="mx-auto w-full max-w-lg rounded-3xl border border-border/70 bg-card p-4 shadow-xl sm:p-6">
    <div className="mb-5 flex items-center justify-between border-b pb-4"><div className="flex items-center gap-2 font-semibold"><Icons.logo className="h-6 w-6 text-primary"/>AU</div><span className="text-xs text-muted-foreground">Illustrative preview</span></div>
    <div className="ml-auto w-fit max-w-full rounded-2xl bg-primary/10 px-4 py-3 text-sm">Why does a thrown ball curve?</div>
    <div className="mt-5 space-y-3"><p className="text-sm leading-relaxed">The ball moves forward while gravity pulls it down. Together, these motions create a curved path.</p><Example type="diagram"/><div className="rounded-xl border border-border p-4"><p className="text-xs font-medium text-muted-foreground">Newton’s second law</p><p className="mt-1 text-2xl font-semibold text-primary">F = m × a</p><p className="mt-1 text-sm text-muted-foreground">Force = mass × acceleration</p></div><p className="text-xs text-muted-foreground">General explanation · Example visual, not a live response</p></div>
  </div>;
}
