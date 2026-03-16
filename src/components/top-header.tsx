'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Show, UserButton, SignInButton } from '@clerk/nextjs';

export function TopHeader() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const toggleTheme = () => {
    document.documentElement.classList.add('transitioning');
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    setTimeout(() => document.documentElement.classList.remove('transitioning'), 350);
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-background/80 border-b border-border">
      <div className="flex items-center justify-between h-14 px-4 max-w-lg mx-auto">
        <span className="text-base font-bold tracking-tight text-foreground">
          Aristora
        </span>

        <div className="flex items-center gap-2">
          {mounted && (
            <button
              onClick={toggleTheme}
              className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors hover:bg-muted active:scale-95"
              aria-label="Toggle theme"
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="w-[18px] h-[18px] text-muted-foreground" />
              ) : (
                <Moon className="w-[18px] h-[18px] text-muted-foreground" />
              )}
            </button>
          )}
          <Show when="signed-in">
            <UserButton />
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="text-sm font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Sign in
              </button>
            </SignInButton>
          </Show>
        </div>
      </div>
    </header>
  );
}
