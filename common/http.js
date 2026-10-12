const cfg = require('./config');
const { httpError } = require('./util');
exports.call = async (base, path, { method = 'GET', body } = {}) => {
  let r;
  try {
    r = await fetch(base + path, {
      method, signal: AbortSignal.timeout(6000),
      headers: { 'content-type': 'application/json', 'x-internal-key': cfg.internalKey },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw httpError(502, 'Upstream service unavailable'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(r.status, j.error || 'Upstream error');
  return j;
};
