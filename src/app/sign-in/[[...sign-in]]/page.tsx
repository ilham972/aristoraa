'use client';

import { SignIn } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function SignInPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';

  const toggleTheme = () => {
    document.documentElement.classList.add('transitioning');
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    setTimeout(() => document.documentElement.classList.remove('transitioning'), 350);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-background">
      {/* Decorative gradient orbs */}
      <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-primary/[0.07] blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-15%] left-[-10%] w-[400px] h-[400px] rounded-full bg-primary/[0.05] blur-[80px] pointer-events-none" />

      {/* Theme toggle */}
      {mounted && (
        <button
          onClick={toggleTheme}
          className="absolute top-5 right-5 w-10 h-10 rounded-xl flex items-center justify-center transition-colors hover:bg-muted active:scale-95 bg-card/60 backdrop-blur-sm border border-border/50"
          aria-label="Toggle theme"
        >
          {isDark ? (
            <Sun className="w-[18px] h-[18px] text-muted-foreground" />
          ) : (
            <Moon className="w-[18px] h-[18px] text-muted-foreground" />
          )}
        </button>
      )}

      {/* Content */}
      <div className="flex flex-col items-center w-full max-w-[400px] px-6">
        {/* Logo + branding */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-lg shadow-primary/20 mb-5 ring-1 ring-border/50">
            <Image
              src="/logo.png"
              alt="Aristora"
              width={80}
              height={80}
              className="w-full h-full object-cover"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Welcome to Aristora
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 text-center">
            Sign in to manage your tuition center
          </p>
        </div>

        {/* Clerk sign-in */}
        <div className="w-full flex justify-center [&_.cl-card]:shadow-none [&_.cl-card]:bg-transparent [&_.cl-internal-b3fm6y]:hidden [&_.cl-footer]:hidden">
          <SignIn
            appearance={{
              baseTheme: isDark ? dark : undefined,
              variables: {
                colorPrimary: isDark ? '#14B8A6' : '#0D9488',
                colorBackground: isDark ? '#131D2E' : '#FFFFFF',
                colorText: isDark ? '#E8EDF2' : '#0F1923',
                colorInputBackground: isDark ? '#1A2836' : '#F0F4F7',
                colorInputText: isDark ? '#E8EDF2' : '#0F1923',
                borderRadius: '0.75rem',
                fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
              },
              elements: {
                rootBox: 'w-full',
                cardBox: 'w-full shadow-none',
                card: `w-full rounded-2xl border border-border/50 ${isDark ? 'bg-card' : 'bg-card'} shadow-xl shadow-black/[0.04]`,
                headerTitle: 'text-foreground font-bold',
                headerSubtitle: 'text-muted-foreground',
                socialButtonsBlockButton:
                  'border-border/50 bg-muted/50 hover:bg-muted text-foreground rounded-xl h-11 transition-all',
                socialButtonsBlockButtonText: 'font-medium text-sm',
                dividerLine: 'bg-border',
                dividerText: 'text-muted-foreground text-xs',
                formFieldLabel: 'text-foreground text-sm font-medium',
                formFieldInput: `rounded-xl h-11 border-border/50 ${isDark ? 'bg-[#1A2836]' : 'bg-secondary'} text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all`,
                formButtonPrimary:
                  'bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-11 font-semibold shadow-md shadow-primary/20 transition-all active:scale-[0.98]',
                footerActionLink: 'text-primary hover:text-primary/80 font-medium',
                identityPreview: 'rounded-xl border-border/50',
                identityPreviewEditButton: 'text-primary',
                formFieldAction: 'text-primary hover:text-primary/80',
                alert: 'rounded-xl',
                avatarBox: 'rounded-xl',
                otpCodeFieldInput: `rounded-lg border-border/50 ${isDark ? 'bg-[#1A2836]' : 'bg-secondary'} text-foreground`,
              },
            }}
            forceRedirectUrl="/"
          />
        </div>

        {/* Footer */}
        <p className="text-[11px] text-muted-foreground/60 mt-8 text-center">
          Aristora Admin
        </p>
      </div>
    </div>
  );
}
