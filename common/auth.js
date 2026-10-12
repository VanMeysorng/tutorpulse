const crypto = require('crypto');
const cfg = require('./config');
const safeEq = (a, b) => { a = Buffer.from(String(a || '')); b = Buffer.from(String(b || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };

// Every downstream service only accepts traffic that carries the gateway's internal key.
exports.trustGateway = (req, res, next) => {
  if (req.path === '/health') return next();
  if (!safeEq(req.get('x-internal-key'), cfg.internalKey)) return res.status(403).json({ error: 'Direct access forbidden. Use the API Gateway.' });
  req.user = req.get('x-user-id') ? { id: req.get('x-user-id'), role: req.get('x-user-role'), name: req.get('x-user-name') } : null;
  next();
};
// Defense in depth: the service re-checks the role the gateway already verified.
exports.role = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: `Role '${req.user.role}' is not allowed here` });
  next();
};
// Service-to-service endpoints: key present, but no end user attached.
exports.internal = (req, res, next) => req.user ? res.status(403).json({ error: 'Internal endpoint' }) : next();
