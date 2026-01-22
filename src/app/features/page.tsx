'use client';
import Link from 'next/link';
import {
  BookCopy,
  BrainCircuit,
  Cpu,
  FileText,
  Home,
  Lightbulb,
  Menu,
  ScanSearch,
  Settings2,
  Share2,
  Sigma,
  SquarePen,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';


const features = [
  {
    title: 'Data Ingestion Engine',
    description: 'Seamlessly upload and process various document formats to build your knowledge base.',
    icon: FileText,
  },
  {
    title: 'Smart Concept Mapping',
    description: 'Visualize connections between key ideas with automatically generated concept maps.',
    icon: Share2,
  },
  {
    title: 'Pattern Recognition for Exams',
    description: 'Identifies recurring themes and topics from past exams to focus your study efforts.',
    icon: ScanSearch,
  },
  {
    title: 'Robust Offline Mode',
    description: 'Access cached data, read materials, and queue questions even without an internet connection.',
    icon: WifiOff,
  },
  {
    title: 'Predictive Question Generator',
    description: 'Generates likely exam questions based on the patterns and weights of your materials.',
    icon: Lightbulb,
  },
  {
    title: 'Practice Exam Generation',
    description: 'Test your knowledge with AU-generated practice exams based on your study materials.',
    icon: SquarePen,
  },
  {
    title: 'Smart Summary & Key Points',
    description: 'Distills long documents into concise summaries and extracts crucial key points for quick review.',
    icon: BookCopy,
  },
  {
    title: 'Installable App (PWA)',
    description: 'Install DataCube AU on your desktop, Android, or iOS device for a native, offline-first experience.',
    icon: Cpu,
  },
  {
    title: 'Personalized Answering Style',
    description: "Adjust the AU's tone and complexity to match your preferred way of learning via an AU Guide file.",
    icon: Settings2,
  },
  {
    title: 'Study Path Recommender',
    description: 'Suggests a step-by-step learning path to efficiently master new subjects.',
    icon: Sigma,
  },
];

export default function FeaturesPage() {
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
                    <Link href="/features" className="text-sm font-medium text-primary transition-colors">Features</Link>
                    <Link href="/about" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">About</Link>
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

      <div className="relative mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="font-headline text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
            Core Intelligence Features
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            DataCube AU is built on a powerful foundation of interconnected AU
            features designed to accelerate your learning.
          </p>
        </div>

        <div className="relative mt-20">
          {/* Central Trunk Line */}
          <div className="absolute left-6 top-0 bottom-0 w-1 -translate-x-1/2 bg-primary/20 md:left-1/2" />

          <div className="space-y-16">
            {features.map((feature, index) => {
              const isLeft = index % 2 === 0;
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className={`group relative flex items-center md:justify-start ${
                    isLeft ? '' : 'md:justify-end'
                  }`}
                >
                  <div className="relative w-full md:max-w-sm pl-12 md:pl-0">
                    <div
                      className={`relative w-full rounded-lg border border-primary/20 bg-card p-6 shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-primary/20 ${
                        isLeft ? 'md:ml-auto' : 'md:mr-auto'
                      }`}
                    >
                      <div className="flex flex-col xs:flex-row items-start xs:items-center gap-4">
                        <div className="rounded-full bg-primary/10 p-3 shrink-0">
                          <Icon className="h-6 w-6 text-primary" />
                        </div>
                        <h3 className="font-headline text-xl font-bold text-foreground">
                          {feature.title}
                        </h3>
                      </div>
                      <p className="mt-3 text-muted-foreground">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                  {/* Branch Connector Point */}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-primary ring-4 ring-background left-6 -translate-x-1/2 md:left-1/2 ${
                      isLeft ? 'md:-translate-x-1/2' : 'md:-translate-x-1/2'
                    }`}
                  />
                  {/* Branch Line */}
                   <div
                    className={`absolute top-1/2 h-1 bg-primary/50 w-6 md:w-[calc(50%-1.25rem)] left-6 -translate-y-1/2 ${
                        isLeft ? 'md:left-auto md:right-1/2' : 'md:left-1/2'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
