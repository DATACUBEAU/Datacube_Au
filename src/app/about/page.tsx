'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Home, Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const phrases = [
  "Your personal AU learning companion...",
  "Transforms your notes into knowledge...",
  "Predicts exam questions to help you focus...",
  "Works offline, anytime, anywhere...",
  "Learns from your materials and predicts exam questions to help you focus..."
];


const features = [
  "Works Offline & Online",
  "Learns From Your Materials",
  "Predicts Exam Questions",
  "Extracts Summaries",
  "Personalized Answer Style",
  "Fast & Interactive",
  "CBT Simulator"
];

function TypingAnimation() {
  const [index, setIndex] = useState(0);
  const [subIndex, setSubIndex] = useState(0);
  const [reverse, setReverse] = useState(false);

  useEffect(() => {
    if (subIndex === phrases[index].length + 1 && !reverse) {
      setTimeout(() => setReverse(true), 1000); // Pause at the end
      return;
    }

    if (subIndex === 0 && reverse) {
      setReverse(false);
      setIndex((prev) => (prev + 1) % phrases.length);
      return;
    }

    const timeout = setTimeout(() => {
      setSubIndex((prev) => prev + (reverse ? -1 : 1));
    }, reverse ? 50 : 100); // Speed up reverse and forward typing

    return () => clearTimeout(timeout);
  }, [subIndex, index, reverse]);

  return (
    <span className="relative">
      {`${phrases[index].substring(0, subIndex)}`}
      <span className="animate-ping absolute right-[-5px] top-0 h-full w-1 bg-primary/80" />
    </span>
  );
}

export default function AboutPage() {
    const navLinks = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/features', label: 'Features' },
    { href: '/about', label: 'About' },
    { href: '/policy', label: 'Policy' },
  ];
  
  return (
    <div className="w-full min-h-dvh bg-transparent text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center space-x-2">
            <Icons.logo className="h-7 w-7 text-primary" />
            <span className="font-headline text-lg font-bold">DataCube AU</span>
          </Link>
          <nav className="hidden items-center space-x-8 md:flex">
            <Link href="/" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary flex items-center gap-1">
              <Home className="h-4 w-4" /> Home
            </Link>
            <Link href="/features" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">Features</Link>
            <Link href="/about" className="text-sm font-medium text-primary transition-colors">About</Link>
            <Link href="/policy" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">Policy</Link>
          </nav>
            <div className="flex items-center justify-end gap-2 sm:gap-4">
              <Button asChild className="hidden md:flex">
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
              <div className="md:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <Menu className="h-5 w-5" />
                      <span className="sr-only">Open menu</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {navLinks.map((link) => (
                      <DropdownMenuItem key={link.href} asChild>
                        <Link href={link.href} className="flex items-center gap-2">
                          {link.icon && <link.icon className="h-4 w-4" />}
                          {link.label}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                     <DropdownMenuItem asChild>
                        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
                          Go to Dashboard
                        </Link>
                      </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        {/* Hero Section */}
        <section className="text-center py-20">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
            About DataCube AU
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-primary h-8">
            <TypingAnimation />
          </p>
        </section>

        {/* Founder Section */}
        <section className="my-20">
            <div className="relative rounded-lg border border-primary/20 bg-card p-8 shadow-lg transition-all duration-300 hover:shadow-primary/20">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
                    <div className="md:col-span-1 flex justify-center">
                        <div className="relative h-48 w-48 rounded-full overflow-hidden border-2 border-primary">
                            <Image 
                                src="/avater.png"
                                alt="Founder of Datacube AU"
                                fill
                                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                style={{ objectFit: 'cover' }}
                            />
                        </div>
                    </div>
                    <div className="md:col-span-2">
                        <h2 className="font-headline text-3xl font-bold text-primary">Founder</h2>
                        <h3 className="text-2xl font-semibold mt-1">Chikezie Fabian Onyebuchi</h3>
                        <p className="mt-4 text-muted-foreground leading-relaxed">
                          Chikezie Fabian Onyebuchi created Datacube AU with a vision to give every student a personal learning companion—an AU that understands their notes, extracts key concepts, predicts exam patterns, and provides academically-precise answers.
                        </p>
                    </div>
                </div>
            </div>
        </section>

        {/* Vision Section */}
        <section className="my-20 text-center">
             <h2 className="font-headline text-4xl font-bold">Why Datacube AU Exists</h2>
             <p className="mt-4 max-w-3xl mx-auto text-muted-foreground leading-relaxed">
                Datacube AU was built to help students study more effectively by transforming any textbook, PDF, or note into intelligent, searchable knowledge. The project blends data-mapping, offline-first AU, personalized learning paths, and predictive exam understanding to help learners reduce study stress, focus on essentials, and understand concepts deeply.
             </p>
        </section>

        {/* Tech Section */}
         <section className="my-20">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                 <div className="rounded-lg border border-primary/20 bg-card p-6 shadow-lg">
                    <h2 className="font-headline text-3xl font-bold text-primary">The AU Engine Behind Datacube AU</h2>
                     <p className="mt-4 text-muted-foreground leading-relaxed">
                      Datacube AU intelligence comes from a custom reasoning system built on local retrieval augmented generation (RAG) and document mapping, similar to how large language models operate. It maps knowledge, detects question patterns, and generates predictions. Unlike cloud‑only systems, it has dual modes: a lighter, faster offline mode for quick responses and an enhanced online mode for more powerful reasoning. It’s designed to be a personal, on‑device learning model.
                    </p>
                 </div>
                 <div className="rounded-lg border border-primary/20 bg-card p-6 shadow-lg">
                    <h2 className="font-headline text-3xl font-bold text-primary">What Makes It Unique</h2>
                     <ul className="mt-4 space-y-3 text-muted-foreground">
                        {features.map(feature => (
                           <li key={feature} className="flex items-center gap-3">
                            <span className="flex h-2 w-2 rounded-full bg-primary" />
                            <span>{feature}</span>
                           </li>
                        ))}
                     </ul>
                 </div>
             </div>
        </section>

      </main>

      <footer className="w-full border-t border-border/40">
        <div className="container flex items-center justify-center py-6 md:justify-between">
          <div className="flex items-center gap-2">
            <Icons.logo className="h-6 w-6 text-primary" />
            <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
              Built by Fabian. © {new Date().getFullYear()} All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
