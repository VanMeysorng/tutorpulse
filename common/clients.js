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
