const cfg = require('./config');
const { call } = require('./http');
const { httpError, oid } = require('./util');
exports.names = async ids => {
  try { return ids.length ? await call(cfg.urls.registration, '/internal/lookup', { method: 'POST', body: { ids: [...new Set(ids)].slice(0, 200) } }) : {}; }
  catch (e) { return {}; }
};
exports.getClass = id => call(cfg.urls.classes, `/internal/classes/${oid(id)}`);
exports.requireClassAccess = async (classId, user, { ownerOnly = false } = {}) => {
  const c = await exports.getClass(classId);
  const owner = c.teacherId === user.id, member = c.studentIds.includes(user.id);
  if (user.role === 'admin' && !ownerOnly) return c;
  if (ownerOnly ? !owner : !(owner || member)) throw httpError(403, 'You do not have access to this class');
  return c;
};
// Cascade delete: ask other services to remove data that belongs to a deleted class or user.
// Best effort: one service being down must not block the delete, so failures are logged and reported.
exports.cascade = async (targets, path) => {
  const out = await Promise.all(targets.map(async t => {
    try { const r = await call(cfg.urls[t], path, { method: 'DELETE' }); return [t, r.deleted ?? 0]; }
    catch (e) { console.error(`cascade ${t}${path} failed: ${e.message}`); return [t, 'failed']; }
  }));
  return Object.fromEntries(out);
};
