import { z } from 'zod';

// zod probes `new Function()` to decide whether it may compile faster validators. The dashboard's
// Content-Security-Policy forbids eval, so the probe would show up as a violation on every load.
// Import this before any module that defines schemas.
z.config({ jitless: true });
