import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import {
  deleteClient,
  getClient,
  getClientAppointments,
  insertClient,
  listClients,
  updateClient,
} from '../db';

export const clients = new Hono<{ Bindings: Env; Variables: AppVars }>();

// GET /api/clients?q=...
clients.get('/', async (c) => {
  const userId = c.get('userId');
  const q = c.req.query('q');
  const items = await listClients(c.env.DB, userId, q);
  return c.json(items);
});

// GET /api/clients/:id
clients.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const client = await getClient(c.env.DB, userId, id);
  if (!client) return c.json({ error: 'not found' }, 404);

  const history = await getClientAppointments(c.env.DB, userId, client.name);
  return c.json({ client, history });
});

// POST /api/clients
clients.post('/', async (c) => {
  const userId = c.get('userId');
  const body: any = await c.req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  if (!name) return c.json({ error: 'Имя клиента обязательно' }, 400);

  const id = await insertClient(c.env.DB, userId, {
    name: name.slice(0, 100),
    phone: body?.phone ? String(body.phone).trim().slice(0, 50) : null,
    telegram: body?.telegram ? String(body.telegram).trim().slice(0, 50) : null,
    notes: body?.notes ? String(body.notes).trim().slice(0, 1000) : null,
  });

  return c.json({ ok: true, id }, 201);
});

// PUT /api/clients/:id
clients.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const body: any = await c.req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  if (!name) return c.json({ error: 'Имя клиента обязательно' }, 400);

  const ok = await updateClient(c.env.DB, userId, id, {
    name: name.slice(0, 100),
    phone: body?.phone ? String(body.phone).trim().slice(0, 50) : null,
    telegram: body?.telegram ? String(body.telegram).trim().slice(0, 50) : null,
    notes: body?.notes ? String(body.notes).trim().slice(0, 1000) : null,
  });

  if (!ok) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// DELETE /api/clients/:id
clients.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const ok = await deleteClient(c.env.DB, userId, id);
  return c.json({ ok });
});
