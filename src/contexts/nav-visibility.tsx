'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

const NavVisibilityContext = createContext<{
  hideBottomNav: boolean;
  setHideBottomNav: (hide: boolean) => void;
}>({ hideBottomNav: false, setHideBottomNav: () => {} });

export function NavVisibilityProvider({ children }: { children: ReactNode }) {
  const [hideBottomNav, setHideBottomNav] = useState(false);
  return (
    <NavVisibilityContext.Provider value={{ hideBottomNav, setHideBottomNav }}>
      {children}
    </NavVisibilityContext.Provider>
  );
}

export function useNavVisibility() {
  return useContext(NavVisibilityContext);
}
