const mongoose = require('mongoose');
exports.wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
exports.httpError = (status, message) => Object.assign(new Error(message), { status });
exports.oid = id => { if (!mongoose.isValidObjectId(id)) throw exports.httpError(400, 'Invalid id'); return id; };
exports.cleanJson = schema => schema.set('toJSON', { transform: (d, r) => { r.id = String(r._id); delete r._id; delete r.__v; return r; } });
