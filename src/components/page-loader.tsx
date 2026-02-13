"use client";

import { Icons } from "./icons";

const PageLoader = () => {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="relative flex h-24 w-24 items-center justify-center">
        {/* Orbiting Dots */}
        <div className="absolute h-16 w-16 animate-[spin_4s_linear_infinite] rounded-full border-2 border-dashed border-primary/50"></div>
        <div className="absolute h-20 w-20 animate-[spin_3s_linear_infinite_reverse] rounded-full border-2 border-dashed border-accent/50"></div>
        
        {/* Pulsing Dots */}
        <div className="absolute h-2.5 w-2.5 animate-pulse rounded-full bg-primary [animation-delay:-0.3s]"></div>
        <div className="absolute h-2.5 w-2.5 animate-pulse rounded-full bg-accent [animation-delay:-0.1s]"></div>
        <div className="absolute h-2.5 w-2.5 animate-pulse rounded-full bg-primary/50"></div>

        {/* Central Logo */}
        <Icons.logo className="h-10 w-10 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.7)]" />
      </div>
      <div className="mt-6 text-center">
        <h2 className="font-headline text-2xl font-bold tracking-wider text-foreground animate-pulse">
          DataCube AU
        </h2>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
};

export default PageLoader;
