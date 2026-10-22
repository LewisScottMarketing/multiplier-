import { Hono } from 'hono';
import { BrandKitSchema } from '@shared/schema';
import { z } from 'zod';
import { jsonBody, rateLimit, requireUser, type Env } from '../http';
import { badRequest } from '../lib/errors';
import { readBrandFromGuidelines } from '../services/brand-guidelines';
import { readBrandFromWebsite } from '../services/brand-site';
import { createBrand, deleteBrand, listBrands, requireBrand, setDefaultBrand, updateBrand } from '../services/brands';

/** Brand kits: a company's colours, typefaces, logo and voice, for pages and the AI to follow. */
export function brandRoutes() {
  const r = new Hono<Env>();
  r.use('*', requireUser);

  r.get('/', (c) => c.json({ brands: listBrands(c.get('app')) }));

  r.post('/', async (c) => {
    const kit = await jsonBody(c, BrandKitSchema);
    return c.json({ brand: createBrand(c.get('app'), kit) }, 201);
  });

  /** Read a brand off a website. Nothing is saved: the person looks it over, edits it and saves it. */
  r.post(
    '/read-website',
    rateLimit('brand-site', 12, 3600_000, (c) => c.get('user').id),
    async (c) => {
      const { url } = await jsonBody(c, z.object({ url: z.string().trim().min(1).max(500) }));
      return c.json({ kit: await readBrandFromWebsite(c.get('app'), url) });
    },
  );

  /** Read a brand off an uploaded guidelines PDF. Nothing is stored: the person looks it over and saves it. */
  r.post(
    '/read-guidelines',
    rateLimit('brand-guidelines', 8, 3600_000, (c) => c.get('user').id),
    async (c) => {
      const file = (await c.req.parseBody()).file;
      if (!(file instanceof File)) throw badRequest('Attach the guidelines as a PDF, in "file".');
      const kit = await readBrandFromGuidelines(c.get('app'), {
        data: Buffer.from(await file.arrayBuffer()),
        filename: file.name || 'guidelines.pdf',
      });
      return c.json({ kit });
    },
  );

  r.get('/:id', (c) => c.json({ brand: requireBrand(c.get('app'), c.req.param('id')) }));

  r.put('/:id', async (c) => {
    const kit = await jsonBody(c, BrandKitSchema);
    return c.json({ brand: updateBrand(c.get('app'), c.req.param('id'), kit) });
  });

  r.post('/:id/default', (c) => c.json({ brand: setDefaultBrand(c.get('app'), c.req.param('id')) }));

  r.delete('/:id', (c) => {
    deleteBrand(c.get('app'), c.req.param('id'));
    return c.json({ ok: true });
  });

  return r;
}
