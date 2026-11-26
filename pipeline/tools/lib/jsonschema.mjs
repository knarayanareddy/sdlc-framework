// A deliberately small JSON Schema subset — exactly the keywords the schemas in
// pipeline/schemas/ use. Kept dependency-free like the rest of the pipeline, and loud about
// keywords it does not implement, so a schema that grows a new assertion fails the alignment
// test instead of being silently ignored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMAS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "schemas");

const load = (name) => JSON.parse(fs.readFileSync(path.join(SCHEMAS, name), "utf8"));
const SUPPORTED = new Set([
  "$schema", "$id", "title", "description", "type", "required", "properties", "additionalProperties",
  "items", "enum", "const", "pattern", "minLength", "minimum", "maximum", "minItems", "allOf", "if", "then",
  "propertyNames", "oneOf", "exclusiveMinimum",
]);

function typeOk(value, type) {
  if (Array.isArray(type)) return type.some((t) => typeOk(value, t));
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      throw new Error(`unsupported type ${type}`);
  }
}

/** Returns a list of violations (empty = valid). Throws on a keyword it does not implement. */
export function validate(doc, schema, at = "$") {
  const errors = [];
  for (const key of Object.keys(schema)) if (!SUPPORTED.has(key)) throw new Error(`schemas.test.mjs does not implement "${key}" (at ${at})`);
  if (schema.type && !typeOk(doc, schema.type)) return [`${at}: expected ${[].concat(schema.type).join("|")}`];
  if (schema.exclusiveMinimum !== undefined && !(typeof doc === "number" && doc > schema.exclusiveMinimum)) return [`${at}: must be greater than ${schema.exclusiveMinimum}`];
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((sub) => validate(doc, sub, at).length === 0).length;
    if (matches !== 1) return [`${at}: must match exactly one of ${schema.oneOf.length} shapes (matched ${matches})`];
  }
  if (schema.const !== undefined && doc !== schema.const) errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(doc)) errors.push(`${at}: must be one of ${schema.enum.join(", ")}`);
  if (typeof doc === "string") {
    if (schema.minLength !== undefined && doc.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(doc)) errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof doc === "number") {
    if (schema.minimum !== undefined && doc < schema.minimum) errors.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && doc > schema.maximum) errors.push(`${at}: above ${schema.maximum}`);
  }
  if (Array.isArray(doc)) {
    if (schema.minItems !== undefined && doc.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.items) doc.forEach((item, i) => errors.push(...validate(item, schema.items, `${at}[${i}]`)));
  }
  if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
    for (const key of schema.required ?? []) if (!(key in doc)) errors.push(`${at}: missing required "${key}"`);
    if (schema.propertyNames) {
      for (const key of Object.keys(doc)) errors.push(...validate(key, schema.propertyNames, `${at}<key ${key}>`));
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) if (key in doc) errors.push(...validate(doc[key], sub, `${at}.${key}`));
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(doc)) if (!(key in (schema.properties ?? {}))) errors.push(`${at}: unexpected property "${key}"`);
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const key of Object.keys(doc)) {
        if (!(key in (schema.properties ?? {}))) errors.push(...validate(doc[key], schema.additionalProperties, `${at}.${key}`));
      }
    }
  }
  for (const sub of schema.allOf ?? []) errors.push(...validate(doc, sub, at));
  if (schema.if) {
    const condition = validate(doc, schema.if, at);
    if (!condition.length && schema.then) errors.push(...validate(doc, schema.then, at));
  }
  return errors;
}


export function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS, name), "utf8"));
}

export { SUPPORTED, SCHEMAS };
