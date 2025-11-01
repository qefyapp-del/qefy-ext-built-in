export function normalizeQueueDocument(input) {
  function normalize(key, value) {
    if (value == null) return undefined; // drop nulls
    // Firestore Timestamp compat
    if (value && typeof value === 'object' && typeof value.toDate === 'function') {
      const d = value.toDate();
      return typeof d?.toISOString === 'function' ? d.toISOString() : undefined;
    }
    if (Array.isArray(value)) {
      const arr = value.map((v) => normalize(null, v)).filter((v) => v !== undefined);
      return arr;
    }
    if (typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) {
        out[k] = normalize(k, value[k]);
        if (out[k] === undefined) delete out[k];
      }
      if (Object.prototype.hasOwnProperty.call(out, 'lastUpdateTS')) {
        const ts = out['lastUpdateTS'];
        if (typeof ts === 'number') {
          try { out['lastUpdateTS'] = new Date(ts).toISOString(); } catch (_) { delete out['lastUpdateTS']; }
        }
      }
      return out;
    }
    return value;
  }
  return normalize(null, input) || {};
}


