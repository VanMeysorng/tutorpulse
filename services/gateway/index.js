const jwt = require('jsonwebtoken');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cfg = require('../../common/config');
cfg.need('JWT_SECRET', 'INTERNAL_KEY');
const { createApp, finish } = require('../../common/app');

const app = createApp('api-gateway', { json: false, db: false });
const INSTANCE = process.env.INSTANCE_ID || require('os').hostname();
app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
// X-Gateway survives proxying (downstream services set their own X-Served-By on /api responses).
app.use((req, res, next) => { res.set('X-Served-By', INSTANCE); res.set('X-Gateway', INSTANCE); next(); });
// Clients may never forge identity headers.
// (someone could send x-user-role: admin themselves, so I delete these first)
app.use((req, res, next) => { ['x-user-id', 'x-user-role', 'x-user-name', 'x-internal-key'].forEach(h => delete req.headers[h]); next(); });
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, try again later' } }));

const ANY = ['admin', 'teacher', 'student'], ID = '(\\/[\\w.-]+)*';
const R = p => new RegExp(`^\\/api\\/${p}$`);
// First match wins. No match = denied.
// My RBAC table: [method, path, roles allowed]. If a route is not here, the gateway blocks it (403).
const RULES = [
  // registration + login (common services)
  ['POST', R('auth\\/(register|login)'), 'public'],
  ['GET', R('auth\\/me'), ANY],
  ['*', R(`auth\\/history${ID}`), ANY],
  ['*', R('users\\/me'), ANY],
  ['*', R(`admin\\/users${ID}`), ['admin']],
  // class-service
  ['POST', R('classes\\/join'), ['student']],
  ['POST', R('classes\\/[\\w.-]+\\/leave'), ['student']],
  ['POST', R('classes\\/[\\w.-]+\\/feedback\\/[\\w.-]+\\/respond'), ['student']],
  ['GET', R(`classes${ID}`), ANY],
  ['*', R(`classes${ID}`), ['teacher']],
  // content-service
  ['POST', R('content\\/assistant'), ANY],
  ['POST', R('content\\/feedback-template'), ['teacher']],
  ['GET', R(`content${ID}`), ['teacher', 'student']],
  ['*', R(`content${ID}`), ['teacher']],
  // practice-service
  ['*', R(`practice${ID}`), ['student']],
  // analytics-service
  ['GET', R('analytics\\/classes\\/[\\w.-]+\\/ranking'), ANY],
  ['GET', R(`analytics${ID}`), ['teacher', 'admin']],
  ['*', R(`analytics\\/classes\\/[\\w.-]+\\/interventions${ID}`), ['teacher']],
];

// Main auth check, runs for every request before it is forwarded:
// 1) find the rule  2) check the JWT  3) check the role  4) pass user id/role + internal key to the service
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (/\.\.|\/\/|%2e|%2f|%5c/i.test(req.originalUrl.split('?')[0])) return res.status(400).json({ error: 'Bad path' });
  const rule = RULES.find(r => (r[0] === '*' || r[0] === req.method) && r[1].test(req.path));
  if (!rule) return res.status(403).json({ error: 'Route not allowed' });
  if (rule[2] !== 'public') {
    const h = req.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' }); // no token -> 401
    let p; // verify signature, issuer and expiry (wrong or expired token -> 401)
    try { p = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'], issuer: 'tutorpulse' }); }
    catch (e) { return res.status(401).json({ error: e.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' }); }
    // token is valid but the role is not allowed on this route -> 403
    if (!rule[2].includes(p.role)) return res.status(403).json({ error: `Role '${p.role}' cannot access this resource` });
    req.headers['x-user-id'] = String(p.sub); req.headers['x-user-role'] = p.role; req.headers['x-user-name'] = encodeURIComponent(p.name || '');
  }
  req.headers['x-internal-key'] = cfg.internalKey;
  next();
});

// Forward each /api path to the right microservice (URLs are the private EC2 IPs from .env)
const P = (target, test, rewrite) => createProxyMiddleware({
  target, changeOrigin: true, proxyTimeout: 10000, timeout: 10000,
  pathFilter: p => test.test(p), pathRewrite: p => p.replace(...rewrite),
  on: { error: (err, req, res) => res.status(502).json({ error: 'Upstream service unavailable' }) },
});
app.use(P(cfg.urls.registration, /^\/api\/auth\/register$/, [/^\/api\/auth/, '']));
app.use(P(cfg.urls.registration, /^\/api\/admin\/users/, [/^\/api\/admin/, '']));
app.use(P(cfg.urls.registration, /^\/api\/users\/me$/, [/^\/api/, '']));
app.use(P(cfg.urls.login, /^\/api\/auth\/(login|me|history(\/[\w.-]+)?)$/, [/^\/api\/auth/, '']));
app.use(P(cfg.urls.classes, /^\/api\/classes/, [/^\/api/, '']));
app.use(P(cfg.urls.content, /^\/api\/content/, [/^\/api/, '']));
app.use(P(cfg.urls.practice, /^\/api\/practice/, [/^\/api/, '']));
app.use(P(cfg.urls.analytics, /^\/api\/analytics/, [/^\/api/, '']));
finish(app);
app.listen(cfg.port, () => console.log(`api-gateway ${INSTANCE} listening on ${cfg.port}`));
