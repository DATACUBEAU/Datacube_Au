'use client';

import {
  FilePlus,
  MessageCircle,
  ClipboardCheck,
  BrainCircuit,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

const quickAccessItems = [
  {
    title: 'Upload Document',
    description: 'Add a new PDF, TXT, or DOCX file.',
    icon: FilePlus,
  },
  {
    title: 'Start AU Chat',
    description: 'Ask questions about your data.',
    icon: MessageCircle,
  },
  {
    title: 'View Predictions',
    description: 'See likely exam questions.',
    icon: ClipboardCheck,
  },
  {
    title: 'Explore Knowledge',
    description: 'Visualize concepts and summaries.',
    icon: BrainCircuit,
  },
];

const RecentDocumentsSkeleton = () => (
  <>
    {[...Array(3)].map((_, i) => (
      <TableRow key={i}>
        <TableCell>
          <Skeleton className="h-4 w-4/5" />
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <Skeleton className="h-4 w-24" />
        </TableCell>
        <TableCell className="text-right">
          <Skeleton className="h-6 w-20 ml-auto" />
        </TableCell>
      </TableRow>
    ))}
  </>
);

export default function DashboardLoading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex items-center">
        <h1 className="font-headline text-2xl font-semibold">
          <Skeleton className="h-8 w-48" />
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {quickAccessItems.map((item) => (
          <Card key={item.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-medium font-headline">{item.title}</CardTitle>
              <item.icon className="h-6 w-6 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              <Skeleton className="h-6 w-20 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:gap-8">
        <Card>
          <CardHeader className="flex flex-row items-center">
            <div className="grid gap-2">
              <CardTitle className="font-headline">Recent Documents</CardTitle>
              <CardDescription>
                Your latest uploads and their status.
              </CardDescription>
            </div>
            <Button asChild size="sm" className="ml-auto gap-1" disabled>
              <span>
                View All
                <ArrowRight className="h-4 w-4" />
              </span>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <RecentDocumentsSkeleton />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
