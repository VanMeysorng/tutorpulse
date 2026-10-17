const e = process.env;
module.exports = {
  port: +e.PORT || 3000,
  mongo: e.MONGO_URL,
  db: e.DB_NAME || 'tp',
  jwtSecret: e.JWT_SECRET,
  jwtExpires: e.JWT_EXPIRES || '1h',
  internalKey: e.INTERNAL_KEY,
  urls: {
    registration: e.REGISTRATION_URL || 'http://registration:3001',
    login: e.LOGIN_URL || 'http://login:3002',
    classes: e.CLASSES_URL || 'http://classes:3003',
    content: e.CONTENT_URL || 'http://content:3004',
    practice: e.PRACTICE_URL || 'http://practice:3005',
    analytics: e.ANALYTICS_URL || 'http://analytics:3006',
  },
  need(...keys) {
    keys.forEach(k => {
      if (!e[k]) throw new Error(`Missing required env var ${k}`);
      if (/^change-me/i.test(e[k])) console.warn(`WARNING: ${k} still uses the public placeholder value. Generate a real secret before deploying.`);
    });
  },
};
