// Minimal ambient shim so the typed serverless API surface (api/**) can read
// process.env without pulling in the full @types/node dependency. The Vercel
// Node/Fluid runtime provides the real `process` at runtime.
declare const process: { env: Record<string, string | undefined> };
