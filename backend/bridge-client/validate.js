// Minimal JSON Schema (2020-12 subset) validator for the generated tool schemas.
// Supports: type, properties, required, additionalProperties:false, enum, const, anyOf, oneOf,
// minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength, pattern,
// items, minItems, maxItems, minProperties. Returns null when valid, else { field, rule, limit? } (field = dotted path).

const typeOk = (t, v) => {
  switch (t) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return false;
  }
};

const err = (path, rule, limit) => (limit === undefined ? { field: path || '.', rule } : { field: path || '.', rule, limit });

export function validate(schema, v, path = '') {
  if (!schema || typeof schema !== 'object') return null;
  if ('const' in schema && v !== schema.const) return err(path, 'const');
  if (schema.enum && !schema.enum.includes(v)) return err(path, 'enum');
  if (schema.anyOf || schema.oneOf) {
    const alts = schema.anyOf || schema.oneOf;
    const ok = alts.filter((s) => validate(s, v, path) === null).length;
    if (schema.anyOf ? ok === 0 : ok !== 1) return err(path, 'any_of');
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(t, v))) return err(path, 'type');
  }
  if (typeof v === 'number') {
    if (schema.minimum != null && v < schema.minimum) return err(path, 'minimum', schema.minimum);
    if (schema.maximum != null && v > schema.maximum) return err(path, 'maximum', schema.maximum);
    if (schema.exclusiveMinimum != null && v <= schema.exclusiveMinimum) return err(path, 'exclusive_minimum', schema.exclusiveMinimum);
    if (schema.exclusiveMaximum != null && v >= schema.exclusiveMaximum) return err(path, 'exclusive_maximum', schema.exclusiveMaximum);
  }
  if (typeof v === 'string') {
    if (schema.minLength != null && v.length < schema.minLength) return err(path, 'min_length', schema.minLength);
    if (schema.maxLength != null && v.length > schema.maxLength) return err(path, 'max_length', schema.maxLength);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) return err(path, 'pattern');
  }
  if (Array.isArray(v)) {
    if (schema.minItems != null && v.length < schema.minItems) return err(path, 'min_items', schema.minItems);
    if (schema.maxItems != null && v.length > schema.maxItems) return err(path, 'max_items', schema.maxItems);
    if (schema.items) for (let i = 0; i < v.length; i++) { const e = validate(schema.items, v[i], (path ? path + '.' : '') + i); if (e) return e; }
  }
  if (typeOk('object', v)) {
    const props = schema.properties || {};
    for (const r of schema.required || []) if (!(r in v)) return err((path ? path + '.' : '') + r, 'required');
    if (schema.minProperties != null && Object.keys(v).length < schema.minProperties) return err(path, 'min_properties', schema.minProperties);
    for (const k of Object.keys(v)) {
      if (k in props) { const e = validate(props[k], v[k], (path ? path + '.' : '') + k); if (e) return e; }
      else if (schema.additionalProperties === false) return err((path ? path + '.' : '') + k, 'unknown_field');
    }
  }
  return null;
}
