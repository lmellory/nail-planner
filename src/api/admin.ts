// API админ-панели Mini App.
//   GET /api/me            — кто я: ID и признак администратора (приложение по нему показывает кнопку панели);
//                            заодно запоминает имя мастера из подписанных данных Telegram.
//   GET /api/admin/masters — список мастеров с числом записей (только для администраторов).
// Сами записи админ правит обычными маршрутами /api/appointments с заголовком X-Act-As (см. auth.ts).
import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import { parseInitDataUser } from '../auth';
import { getUserNames, listUsersAdmin, saveUserName } from '../db';
import { getAccessSnapshot, isAdmin } from '../lib/access';
import { nowInTz } from '../lib/time';

export const me = new Hono<{ Bindings: Env; Variables: AppVars }>();

me.get('/', async (c) => {
  const actorId = c.get('actorId');
  const u = parseInitDataUser(c.req.header('X-Init-Data') ?? '');
  // Имя сохраняем только у самого пользователя; при сбое (например, нет миграции 0014) молча пропускаем
  if (u && u.id === actorId) await saveUserName(c.env.DB, actorId, u.name, u.username).catch(() => {});
  return c.json({ user_id: actorId, is_admin: c.get('isAdmin') });
});

export const adminApi = new Hono<{ Bindings: Env; Variables: AppVars }>();

adminApi.use('*', async (c, next) => {
  if (!c.get('isAdmin')) return c.json({ error: 'forbidden' }, 403);
  await next();
});

export interface MasterRow {
  user_id: number;
  name: string | null;
  username: string | null;
  appointments: number;
  upcoming: number;
  clients: number;
  last_appointment: string | null;
  has_access: boolean;
  banned: boolean;
}

adminApi.get('/masters', async (c) => {
  const { date } = nowInTz(c.env.TZ);
  const [rows, access, names] = await Promise.all([
    listUsersAdmin(c.env.DB, date),
    getAccessSnapshot(c.env),
    getUserNames(c.env.DB).catch(() => new Map<number, { name: string | null; username: string | null }>()),
  ]);

  const masters: MasterRow[] = [];
  const seen = new Set<number>();
  const push = (id: number, r?: (typeof rows)[number]) => {
    seen.add(id);
    const hasAccess = access.allowed.includes(id);
    // Администратор без доступа мастера и без записей — не мастер (просто открывал приложение)
    if (isAdmin(c.env, id) && !hasAccess && !(r && r.appointments > 0)) return;
    masters.push({
      user_id: id,
      name: names.get(id)?.name ?? null,
      username: names.get(id)?.username ?? null,
      appointments: r?.appointments ?? 0,
      upcoming: r?.upcoming ?? 0,
      clients: r?.clients ?? 0,
      last_appointment: r?.last_appointment ?? null,
      has_access: hasAccess,
      banned: access.banned.includes(id),
    });
  };
  for (const r of rows) push(r.user_id, r);
  for (const id of access.allowed) if (!seen.has(id)) push(id); // есть доступ, но ещё не открывали бота

  masters.sort((a, b) => Number(b.has_access) - Number(a.has_access) || (a.name ?? '￿').localeCompare(b.name ?? '￿', 'ru') || a.user_id - b.user_id);
  return c.json({ masters });
});
