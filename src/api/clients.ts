import { Hono } from 'hono';
import { cleanBirthday, parseClientPayload } from '../lib/clients';
export { cleanBirthday };
import type { AppVars, Env } from '../types';
import { deleteClient, getClient, getClientAppointments, insertClient, listClients, updateClient } from '../db/clients';

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
  const parsed = parseClientPayload(await c.req.json().catch(() => null));
  if (!parsed.data) return c.json({ error: parsed.error }, 400);
  if (parsed.invalidTelegram) return c.json({ error: 'Некорректный username Telegram' }, 400);
  const id = await insertClient(c.env.DB, userId, parsed.data);

  return c.json({ ok: true, id }, 201);
});

// PUT /api/clients/:id
clients.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400);

  const current = await getClient(c.env.DB, userId, id);
  if (!current) return c.json({ error: 'not found' }, 404);
  const parsed = parseClientPayload(await c.req.json().catch(() => null));
  if (!parsed.data) return c.json({ error: parsed.error }, 400);
  if (parsed.invalidTelegram && parsed.rawTelegram !== current.telegram) return c.json({ error: 'Некорректный username Telegram' }, 400);
  const result = await updateClient(c.env.DB, userId, id, {
    ...parsed.data, telegram: parsed.invalidTelegram ? current.telegram : parsed.data.telegram,
  });
  if (result === 'not_found') return c.json({ error: 'not found' }, 404);
  if (result === 'name_taken') return c.json({ error: 'Клиент с таким именем уже существует' }, 409);
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
