import type { ModpackLoader } from '../../shared/ipc';

// NeoForge/Forge bootstrap uses reflective access on modern Java.
// Keep these flags scoped to Forge-family personal profiles.
const FORGE_MODULE_FLAGS = [
  '--add-opens=java.base/java.lang.invoke=ALL-UNNAMED',
  '--add-opens=java.base/java.lang=ALL-UNNAMED',
  '--add-opens=java.base/java.io=ALL-UNNAMED',
  '--add-opens=java.base/java.util=ALL-UNNAMED',
  '--add-opens=java.base/java.util.jar=ALL-UNNAMED',
  '--add-opens=java.base/sun.nio.fs=ALL-UNNAMED',
  '--add-exports=java.base/sun.security.util=ALL-UNNAMED',
] as const;

export function withLoaderJvmArgs(loader: ModpackLoader, base: readonly string[]): string[] {
  if (loader !== 'forge' && loader !== 'neoforge') return [...base];
  return [...base, ...FORGE_MODULE_FLAGS];
}
