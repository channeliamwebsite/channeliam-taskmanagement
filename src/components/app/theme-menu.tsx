"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { THEME_EVENT, applyThemePreference, readThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Light / Dark / System choice for the account menu. */
export function ThemeMenuItems() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const sync = () => setPreference(readThemePreference());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Appearance</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={preference}
        onValueChange={(value) => applyThemePreference(value as ThemePreference)}
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuRadioItem key={value} value={value} closeOnClick={false}>
            <Icon aria-hidden="true" /> {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

/** "light" | "dark" actually shown, following system changes when set to System. */
export function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (readThemePreference() === "system") document.documentElement.classList.toggle("dark", media.matches);
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    };
    update();
    media.addEventListener("change", update);
    window.addEventListener(THEME_EVENT, update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener(THEME_EVENT, update);
    };
  }, []);

  return theme;
}
