/**
 * Provides shared styling utilities used by reusable UI components.
 *
 * The app relies on Tailwind utility classes and variant helpers. This module
 * keeps class merging consistent so callers can safely combine defaults,
 * conditional classes, and overrides.
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges conditional class names and resolves Tailwind utility conflicts.
 *
 * clsx handles booleans, arrays, and object syntax while tailwind-merge removes
 * conflicting utilities. The result is a clean class string suitable for reusable
 * components with caller-provided overrides.
 *
 * @param inputs - Class name values accepted by clsx.
 * @returns A merged class name string with Tailwind conflicts resolved.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
