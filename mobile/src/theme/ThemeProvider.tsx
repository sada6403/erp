import React, { createContext, useContext, useMemo } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useThemeStore } from '@/store/themeStore';
import { themes, type Theme } from './themes';

const ThemeContext = createContext<Theme>(themes.olive);

export function ThemeProvider({ children, forceTheme }: { children: React.ReactNode; forceTheme?: Theme }) {
  const key = useThemeStore((s) => s.theme);
  const theme = forceTheme ?? themes[key] ?? themes.olive;
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * makeStyles(theme => ({...})) returns a hook that memoises StyleSheet.create per theme,
 * so both themes work without hard-coded colours.
 */
export function makeStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(factory: (theme: Theme) => T) {
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => StyleSheet.create(factory(theme)), [theme]);
  };
}
