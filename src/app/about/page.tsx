'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Icons } from '@/components/icons';
import { CompanyFooter } from '@/components/company-footer';
import { Button } from '@/components/ui/button';

const navigation = [
  { href: '/', label: 'Home' },
  { href: '/features', label: 'Features' },
  { href: '/about', label: 'About' },
  { href: '/policy', label: 'Policy' },
];

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

          <Button asChild size="sm">
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium text-primary">About us</p>
          <h1 className="mt-3 font-headline text-4xl font-bold tracking-tight sm:text-5xl">
            Learning starts with understanding.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            DataCube AU helps students make better use of their learning materials.
            Upload notes and documents, ask questions about them, and keep your study
            resources organised in one place.
          </p>
        </section>

        <section className="mt-16 grid items-center gap-10 rounded-xl border border-border bg-card p-6 sm:p-8 md:grid-cols-[220px_1fr]">
          <div className="mx-auto w-full max-w-[220px]">
            <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-muted">
              <Image
                src="/avater.png"
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
            summaries, and support your study sessions.
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
