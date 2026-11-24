'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Icons } from '@/components/icons';
import { CompanyFooter } from '@/components/company-footer';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const navigation = [
  { href: '/', label: 'Home' },
  { href: '/features', label: 'Features' },
  { href: '/about', label: 'About' },
  { href: '/policy', label: 'Policy' },
  { href: '/download', label: 'Download' },
];

const introPhrases = [
  'Your personal AU learning companion...',
  'Transforms your notes into knowledge...',
  'Helps you identify topics to review...',
  'Supports offline study with downloaded models...',
  'Uses your materials to ground study explanations...',
];

function TypingAnimation() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [characterIndex, setCharacterIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const currentPhrase = introPhrases[phraseIndex];

    if (!deleting && characterIndex === currentPhrase.length) {
      const pause = window.setTimeout(() => setDeleting(true), 1200);
      return () => window.clearTimeout(pause);
    }

    if (deleting && characterIndex === 0) {
      setDeleting(false);
      setPhraseIndex((current) => (current + 1) % introPhrases.length);
      return;
    }

    const timer = window.setTimeout(() => {
      setCharacterIndex((current) => current + (deleting ? -1 : 1));
    }, deleting ? 40 : 75);

    return () => window.clearTimeout(timer);
  }, [characterIndex, deleting, phraseIndex]);

  return (
    <span className="relative inline-block">
      {introPhrases[phraseIndex].slice(0, characterIndex)}
      <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-px animate-pulse bg-primary align-middle" />
    </span>
  );
}

export default function AboutPage() {
  return (
    <div className="min-h-dvh w-full bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <Icons.logo className="h-7 w-7 text-primary" />
            <span className="font-headline text-lg font-bold">DataCube AU</span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.href === '/about' ? 'page' : undefined}
                className={item.href === '/about'
                  ? 'text-sm font-medium text-primary'
                  : 'text-sm font-medium text-muted-foreground transition-colors hover:text-primary'}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open navigation menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {navigation.map((item) => (
                <DropdownMenuItem key={item.href} asChild>
                  <Link
                    href={item.href}
                    aria-current={item.href === '/about' ? 'page' : undefined}
                    className={item.href === '/about' ? 'font-semibold text-primary' : undefined}
                  >
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl py-10 text-center">
          <p className="text-sm font-medium text-primary">About us</p>
          <h1 className="mt-3 font-headline text-4xl font-bold tracking-tight sm:text-5xl">
            Learning starts with understanding.
          </h1>
          <p className="mx-auto mt-5 min-h-8 max-w-2xl text-lg text-primary">
            <TypingAnimation />
          </p>
          <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            DataCube AU helps students make better use of their learning materials.
            Import notes and documents into the Android app, ask questions about them, and keep your study
            resources organised in one place.
          </p>
        </section>

        <section className="mt-12 grid items-center gap-10 rounded-xl border border-border bg-card p-6 sm:p-8 md:grid-cols-[220px_1fr]">
          <div className="mx-auto w-full max-w-[220px]">
            <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
              <Image
                src="/Prova.png"
                alt="Chikezie Fabian Onyebuchi, founder of DataCube AU"
                fill
                sizes="(max-width: 768px) 220px, 220px"
                className="object-cover object-center"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-primary">The founder</p>
            <h2 className="mt-2 font-headline text-2xl font-semibold">
              Chikezie Fabian Onyebuchi
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Founder, DataCube AU
            </p>
            <p className="mt-5 leading-relaxed text-muted-foreground">
              I started DataCube AU to make studying and working with documents
              simpler. The goal is to give learners a practical place to organise
              their materials, find information, and get help understanding what
              they are studying.
            </p>
          </div>
        </section>

        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="font-headline text-2xl font-semibold">What DataCube AU does</h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            DataCube AU is a document and study assistant. It helps you work with
            your own files by making their content easier to search, review, and
            discuss. You can use it to ask questions about your materials, create
            Smart Notes, practice questions and audio discussions. Supported AU models run on your device; account services, billing and model downloads may require a connection.
          </p>
        </section>

        <section className="mx-auto mt-12 max-w-3xl">
          <h2 className="font-headline text-2xl font-semibold">Our aim</h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            We want useful learning tools to feel clear and accessible. We focus
            on building a dependable product that helps people spend less time
            searching through documents and more time understanding the information
            that matters.
          </p>
        </section>
      </main>

      <CompanyFooter />
    </div>
  );
}
