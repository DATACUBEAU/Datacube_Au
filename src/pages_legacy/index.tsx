'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { CompanyFooter } from '@/components/company-footer';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { Home, Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function LandingPage() {
  const heroIllustration = PlaceHolderImages.find((p) => p.id === 'app-showcase');
  const navLinks = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/features', label: 'Features' },
    { href: '/about', label: 'About' },
  ];

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center space-x-2">
            <Icons.logo className="h-7 w-7 text-primary" />
            <span className="font-headline text-lg font-bold">DataCube AU</span>
          </Link>
          <nav className="hidden items-center space-x-8 md:flex">
            <Link
              href="/"
              className="text-sm font-medium text-primary transition-colors flex items-center gap-1"
            >
              <Home className="h-4 w-4" /> Home
            </Link>
            <Link
              href="/features"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              Features
            </Link>
            <Link
              href="/about"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              About
            </Link>
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

      <main className="relative w-full flex-1 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-[60rem] w-[60rem] rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-full max-w-7xl flex-col justify-center">
          <section className="grid grid-cols-1 items-center gap-12 px-4 py-16 md:grid-cols-2 md:py-24 lg:px-8">
            <div className="space-y-6 text-center md:text-left">
              <h1 className="font-headline text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
                Unlock the Power of Your Documents with AU
              </h1>
              <p className="max-w-2xl text-lg text-muted-foreground md:mx-0 mx-auto">
                DataCube AU transforms your scattered notes, textbooks, and study materials into an
                intelligent, searchable knowledge base. Ask questions, get A U insights, and study
                smarter.
              </p>
              <div className="flex justify-center md:justify-start">
                <Button asChild size="lg">
                  <Link href="/dashboard">Get Started</Link>
                </Button>
              </div>
            </div>
            <div className="relative flex h-full min-h-[300px] w-full items-center justify-center">
              {heroIllustration && (
                <Image
                  src={heroIllustration.imageUrl}
                  alt={heroIllustration.description}
                  width={600}
                  height={400}
                  className="rounded-lg object-contain"
                  data-au-hint={heroIllustration.imageHint}
                />
              )}
            </div>
          </section>
        </div>
      </main>

      <CompanyFooter />
    </div>
  );
}

