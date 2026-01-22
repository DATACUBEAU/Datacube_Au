'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { Home, Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function PolicyPage() {
  const navLinks = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/features', label: 'Features' },
    { href: '/about', label: 'About' },
    { href: '/policy', label: 'Policy' },
  ];

  return (
    <div className="w-full min-h-dvh bg-background text-foreground">
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
            <Link href="/about" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">About</Link>
            <Link href="/policy" className="text-sm font-medium text-primary transition-colors">Policy</Link>
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

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <section className="mb-8 rounded-lg border border-primary/20 bg-card p-6">
          <p className="text-sm text-muted-foreground">
            By continuing, you agree to our <Link href="#terms" className="text-primary underline underline-offset-4">Terms of Service</Link> and <Link href="#privacy" className="text-primary underline underline-offset-4">Privacy Policy</Link>.
          </p>
        </section>

        <section id="terms" className="space-y-4">
          <h1 className="font-headline text-3xl font-bold">Terms of Service</h1>
          <p className="text-muted-foreground">
            These Terms govern your use of the DataCube AU application. By using the service, you acknowledge and accept these terms.
          </p>
          <h2 className="font-headline text-xl font-semibold">User Responsibilities</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>Provide accurate information and keep your account secure.</li>
            <li>Use the service only for lawful, educational, and personal study purposes.</li>
            <li>Respect intellectual property rights; upload only materials you have the right to use.</li>
            <li>Do not attempt to disrupt, reverse‑engineer, or bypass security or access controls.</li>
            <li>Avoid harmful content, spam, automated scraping, or abusive usage patterns.</li>
            <li>Report issues that impact security, privacy, or service integrity.</li>
          </ul>
          <h2 className="font-headline text-xl font-semibold">Acceptable Use</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>No copyright infringement, malware distribution, or unlawful content.</li>
            <li>No attempts to overload the system or degrade service for others.</li>
            <li>No commercial resale or white‑labeling without prior written permission.</li>
          </ul>
          <h2 className="font-headline text-xl font-semibold">Content and Availability</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>You retain rights to your uploaded documents. Processing creates derived data to power features like concept maps and practice questions.</li>
            <li>Service availability may vary; features can change or be suspended for maintenance or safety.</li>
          </ul>
        </section>

        <section id="privacy" className="mt-12 space-y-4">
          <h1 className="font-headline text-3xl font-bold">Privacy Policy</h1>
          <p className="text-muted-foreground">
            This policy describes how we handle your data when you use DataCube AU.
          </p>
          <h2 className="font-headline text-xl font-semibold">Data We Process</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>Account details (for authenticated users) such as email and profile metadata.</li>
            <li>Uploaded documents and derived text chunks used for study features.</li>
            <li>Usage metadata, device information, and event logs for reliability and performance.</li>
            <li>Local storage and cookies used to support offline features and preferences.</li>
          </ul>
          <h2 className="font-headline text-xl font-semibold">Security</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>Data is protected in transit and at rest with industry‑standard practices.</li>
            <li>Access is restricted and monitored; we minimize collection to what is necessary.</li>
          </ul>
          <h2 className="font-headline text-xl font-semibold">Retention and Deletion</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>Guest sessions and their associated data are deleted after 14 days.</li>
            <li>Inactive authenticated accounts and associated data are deleted after 14 days of inactivity.</li>
            <li>Cached AU responses and temporary processing artifacts are deleted after 14 days of inactivity.</li>
            <li>You may request deletion sooner via account settings or support.</li>
          </ul>
          <h2 className="font-headline text-xl font-semibold">Your Rights</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>Access, export, and delete your data where available.</li>
            <li>Withdraw consent and stop using the service at any time.</li>
          </ul>
          <h2 className="font-headline text-xl font-semibold">Updates</h2>
          <p className="text-muted-foreground">We may update these terms and policies. Material changes will be communicated within the app. Continued use constitutes acceptance of the updated terms.</p>
        </section>

        <section className="mt-12">
          <div className="rounded-lg border border-primary/20 bg-card p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Need help or want to delete your data?</p>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard">Open Dashboard</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/features">Explore Features</Link>
                </Button>
              </div>
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

