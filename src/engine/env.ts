/**
 * Measurement knobs: environment variables read under tsx (scripts, tests). The browser has no
 * `process`, so every knob reads undefined there and its default applies.
 */
export const processEnv: Record<string, string | undefined> | undefined = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
export const envVar = (name: string): string | undefined => processEnv?.[name];
