#!/usr/bin/env node
/**
 * Contract check: frontend types vs the REAL backend.
 *
 * Why this exists: the typed client and the backend were built separately, and each side's tests used
 * mocks of the other, so both could pass while the real responses did not match the types (a list that
 * was an array in the API but an object in the client left whole screens empty). This script calls every
 * endpoint the client uses against a running API, then checks the actual JSON against the TypeScript type
 * the client declares for it, using the TypeScript compiler's own type information. It fails on any
 * missing required field, wrong kind of value, array-vs-object mismatch or wrong literal.
 *
 * Usage (API must be running; use a throwaway analyst):
 *   CONTRACT_USER=soc_lead CONTRACT_PASSWORD=... [API_BASE=http://127.0.0.1:8000] node scripts/contract-check.mjs
 *
 * Mutating endpoints (register, settings update, containment, ...) are never called. For those, and for any
 * endpoint with no data yet, the response is checked against a sample built from the API's own OpenAPI
 * schema instead. Two safe POSTs are called for real: /auth/ws-ticket and /audit-trail/verify.
 *
 * The other direction is checked too: every request body the client sends must supply each field the
 * backend requires and must not send a field the backend does not define.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const API = process.env.API_BASE ?? 'http://127.0.0.1:8000';
const USER = process.env.CONTRACT_USER;
const PASSWORD = process.env.CONTRACT_PASSWORD;
if (!USER || !PASSWORD) {
  console.error('Set CONTRACT_USER and CONTRACT_PASSWORD (a throwaway analyst) to run the contract check.');
  process.exit(2);
}

// ---- read the client's endpoints and declared types with the TypeScript compiler -----------------
const clientFile = path.join(root, 'src/api/client.ts');
const program = ts.createProgram([clientFile], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  noEmit: true,
  types: [],
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(clientFile);

/** Text of a path expression with every ${...} turned into {name}, where name is the identifier inside. */
function pathTemplate(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const inner = span.expression.getText(source);
      const name = (/\((\w+)\)/.exec(inner) ?? /(\w+)/.exec(inner))[1];
      out += `{${name}}` + span.literal.text;
    }
    return out;
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'withQuery') return pathTemplate(node.arguments[0]);
  return null;
}

function methodOf(optionsNode) {
  if (!optionsNode || !ts.isObjectLiteralExpression(optionsNode)) return 'GET';
  for (const prop of optionsNode.properties) {
    if (ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'method') return prop.initializer.getText(source).replace(/['"]/g, '');
  }
  return 'GET';
}

/** The checker's type of the `body` property in a request options object, or null. */
function bodyTypeOf(optionsNode) {
  if (!optionsNode || !ts.isObjectLiteralExpression(optionsNode)) return null;
  for (const prop of optionsNode.properties) {
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.getText(source) === 'body') return checker.getTypeAtLocation(prop.name);
    if (ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'body') return checker.getTypeAtLocation(prop.initializer);
  }
  return null;
}

const endpoints = [];
ts.forEachChild(source, function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    const fn = node.name.text;
    ts.forEachChild(node, function find(child) {
      if (ts.isCallExpression(child) && child.expression.getText(source) === 'request' && child.typeArguments?.length === 1) {
        const tpl = pathTemplate(child.arguments[0]);
        if (tpl) {
          endpoints.push({
            fn,
            method: methodOf(child.arguments[1]),
            path: tpl,
            typeNode: child.typeArguments[0],
            isPublic: /public:\s*true/.test(child.arguments[1]?.getText(source) ?? ''),
            bodyType: bodyTypeOf(child.arguments[1]),
          });
        }
      }
      ts.forEachChild(child, find);
    });
  }
  ts.forEachChild(node, visit);
});

// ---- validate a JSON value against a TypeScript type ----------------------------------------------
const F = ts.TypeFlags;
/** Placeholder the OpenAPI sampler uses for a plain string. Never a real API value. */
const SAMPLE_STRING = '__sample__';
/** A free-form object in the OpenAPI schema (dict[str, Any]) says nothing about its keys, so no client type can be
 * judged against it. The live API is what proves those; the sampler hands this marker to validate() to skip them. */
const FREE_FORM = Object.freeze({ freeForm: true });

function kindOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validate(value, type, where, errors, depth = 0) {
  if (depth > 9 || value === FREE_FORM) return;
  if (type.isUnion()) {
    const attempts = type.types.map((member) => {
      const found = [];
      validate(value, member, where, found, depth + 1);
      return found;
    });
    if (attempts.some((found) => found.length === 0)) return;
    attempts.sort((a, b) => a.length - b.length);
    errors.push(...attempts[0]);
    return;
  }
  if (type.flags & (F.Any | F.Unknown | F.TypeParameter)) return;
  if (type.flags & F.StringLiteral) {
    // In a sample built from the OpenAPI schema, a plain string field is the dummy "x". The backend does not
    // narrow it to the client's union, so a literal type cannot be judged from the dummy. Live values can.
    if (value === SAMPLE_STRING) return;
    if (value !== type.value) errors.push(`${where}: expected "${type.value}", got ${JSON.stringify(value)}`);
    return;
  }
  if (type.flags & F.NumberLiteral) {
    if (value !== type.value) errors.push(`${where}: expected ${type.value}, got ${JSON.stringify(value)}`);
    return;
  }
  if (type.flags & F.BooleanLiteral) {
    if (value !== (type.intrinsicName === 'true')) errors.push(`${where}: expected ${type.intrinsicName}, got ${JSON.stringify(value)}`);
    return;
  }
  if (type.flags & F.String) {
    if (typeof value !== 'string') errors.push(`${where}: expected string, got ${kindOf(value)}`);
    return;
  }
  if (type.flags & F.Number) {
    if (typeof value !== 'number') errors.push(`${where}: expected number, got ${kindOf(value)}`);
    return;
  }
  if (type.flags & F.Boolean) {
    if (typeof value !== 'boolean') errors.push(`${where}: expected boolean, got ${kindOf(value)}`);
    return;
  }
  if (type.flags & F.Null) {
    if (value !== null) errors.push(`${where}: expected null, got ${kindOf(value)}`);
    return;
  }
  if (type.flags & (F.Undefined | F.Void)) {
    if (value !== undefined && value !== null) errors.push(`${where}: expected nothing, got ${kindOf(value)}`);
    return;
  }
  if (checker.isArrayType(type)) {
    if (!Array.isArray(value)) {
      errors.push(`${where}: expected array, got ${kindOf(value)}`);
      return;
    }
    const element = checker.getTypeArguments(type)[0];
    value.slice(0, 50).forEach((item, index) => validate(item, element, `${where}[${index}]`, errors, depth + 1));
    return;
  }
  // Object-like (interfaces, literals, Record).
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${where}: expected object, got ${kindOf(value)}`);
    return;
  }
  const properties = checker.getPropertiesOfType(type);
  for (const property of properties) {
    const name = property.getName();
    const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
    const propertyType = checker.getTypeOfSymbol(property);
    if (!(name in value)) {
      const allowsUndefined = propertyType.isUnion() && propertyType.types.some((t) => t.flags & F.Undefined);
      if (!optional && !allowsUndefined) errors.push(`${where}.${name}: missing (backend sent keys: ${Object.keys(value).slice(0, 12).join(', ')})`);
      continue;
    }
    validate(value[name], propertyType, `${where}.${name}`, errors, depth + 1);
  }
  if (properties.length === 0) {
    for (const info of checker.getIndexInfosOfType(type)) {
      for (const [key, item] of Object.entries(value).slice(0, 8)) validate(item, info.type, `${where}.${key}`, errors, depth + 1);
    }
  }
}

// ---- call the real API ------------------------------------------------------------------------------
async function call(method, route, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${route}`, { method, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const loginResponse = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASSWORD }),
});
if (!loginResponse.ok) {
  console.error(`Login failed (${loginResponse.status}). Is the API running at ${API} and the analyst registered?`);
  process.exit(2);
}
const token = (await loginResponse.json()).access_token;

// Real ids to fill path parameters with.
const listing = (await call('GET', '/investigations?limit=50', token)).body;
const rows = Array.isArray(listing) ? listing : (listing?.items ?? []);
const done = rows.find((r) => ['verdict_reached', 'contained', 'ambiguous'].includes(r.status)) ?? rows[0];
const investigationId = done?.investigation_id ?? done?.id;
const recent = (await call('GET', '/raw-logs/recent?limit=1', token)).body;
const rowId = (Array.isArray(recent) ? recent[0] : recent?.items?.[0])?.row_id;
const me = (await call('GET', '/auth/me', token)).body;
const context = { id: investigationId, agentId: 'network_traffic', rowId, userId: me?.analyst_id };

// ---- the API's own OpenAPI schema --------------------------------------------------------------------
const spec = await (await fetch(`${API}/openapi.json`)).json();
const schemas = spec.components?.schemas ?? {};
const shape = (route) => route.replace(/\{[^}]+\}/g, '{}');
const openapiPaths = new Map(Object.keys(spec.paths).map((route) => [shape(route), route]));

function deref(schema) {
  let current = schema;
  while (current?.$ref) current = schemas[current.$ref.split('/').pop()];
  return current;
}

/** A synthetic instance of a schema: required shape and enum members, dummy leaf values. */
function sample(schema, depth = 0) {
  if (!schema || depth > 8) return null;
  if (schema.$ref) return sample(deref(schema), depth + 1);
  if (schema.anyOf) {
    const nonNull = schema.anyOf.find((member) => member.type !== 'null');
    return nonNull ? sample(nonNull, depth + 1) : null;
  }
  if (schema.allOf) return sample(schema.allOf[0], depth + 1);
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const [key, value] of Object.entries(schema.properties ?? {})) out[key] = sample(value, depth + 1);
      if (!schema.properties && typeof schema.additionalProperties === 'object') out.sample = sample(schema.additionalProperties, depth + 1);
      if (!schema.properties && (schema.additionalProperties === true || schema.additionalProperties === undefined)) return FREE_FORM;
      return out;
    }
    case 'array':
      return [sample(schema.items, depth + 1)];
    case 'string':
      return schema.format === 'date-time' ? '2026-10-09T00:00:00Z' : SAMPLE_STRING;
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function operationOf(endpoint) {
  const route = openapiPaths.get(shape(endpoint.path));
  return route ? spec.paths[route][endpoint.method.toLowerCase()] : undefined;
}

function responseSchemaOf(operation) {
  for (const [code, response] of Object.entries(operation?.responses ?? {})) {
    if (!code.startsWith('2')) continue;
    const schema = response.content?.['application/json']?.schema;
    // A route with no response model declares an empty schema; keep looking for a documented 2xx.
    if (schema && Object.keys(schema).length > 0) return schema;
  }
  return null;
}

/** Request direction: the client's body type against the backend's request model. */
function checkBody(endpoint) {
  const operation = operationOf(endpoint);
  const requestSchema = deref(operation?.requestBody?.content?.['application/json']?.schema);
  if (!endpoint.bodyType || !requestSchema?.properties) return [];
  const problems = [];
  const sent = new Map(checker.getPropertiesOfType(endpoint.bodyType).map((p) => [p.getName(), (p.flags & ts.SymbolFlags.Optional) !== 0]));
  for (const name of requestSchema.required ?? []) {
    if (!sent.has(name)) problems.push(`body: backend requires "${name}" but the client body type has no such field`);
    else if (sent.get(name)) problems.push(`body: backend requires "${name}" but the client may omit it`);
  }
  for (const name of sent.keys()) {
    if (!(name in requestSchema.properties)) problems.push(`body: client may send "${name}" which the backend does not define`);
  }
  return problems;
}

const SAFE_POSTS = new Set(['/auth/ws-ticket', '/audit-trail/verify']);
let failures = 0;
let checked = 0;
let sampled = 0;
let skipped = 0;

function report(label, typeText, tag, errors) {
  if (errors.length === 0) {
    console.log(`${tag.padEnd(4)} ${label.padEnd(58)} ${typeText}`);
    return;
  }
  failures += 1;
  const unique = [...new Set(errors)];
  console.log(`FAIL ${label.padEnd(58)} ${typeText}`);
  for (const message of unique.slice(0, 8)) console.log(`       ${message}`);
  if (unique.length > 8) console.log(`       ... and ${unique.length - 8} more`);
}

for (const endpoint of endpoints) {
  const label = `${endpoint.method.padEnd(4)} ${endpoint.path}`;
  const typeText = endpoint.typeNode.getText(source);
  const expected = checker.getTypeFromTypeNode(endpoint.typeNode);
  const bodyProblems = checkBody(endpoint);

  const live = endpoint.method === 'GET' || SAFE_POSTS.has(endpoint.path);
  let resolved = endpoint.path;
  let missingContext = null;
  for (const [, name] of endpoint.path.matchAll(/\{(\w+)\}/g)) {
    if (!context[name]) missingContext = name;
    resolved = resolved.replace(`{${name}}`, encodeURIComponent(context[name] ?? ''));
  }

  if (live && !missingContext) {
    const { status, body } = await call(endpoint.method, resolved, endpoint.isPublic ? undefined : token);
    if (status === 403) {
      // The analyst lacks a capability for this read. Fall through to the schema sample below.
    } else if (status >= 400) {
      failures += 1;
      console.log(`FAIL ${label}  -> HTTP ${status} ${typeof body === 'object' ? JSON.stringify(body).slice(0, 120) : body}`);
      continue;
    } else {
      const errors = [...bodyProblems];
      validate(body, expected, '$', errors);
      checked += 1;
      report(label, typeText, 'ok', errors);
      continue;
    }
  }

  // Not called for real: validate a sample built from the OpenAPI response schema instead.
  const responseSchema = responseSchemaOf(operationOf(endpoint));
  if (!responseSchema) {
    // 204 / no JSON body. Only the request side can be checked.
    if (bodyProblems.length) report(label, typeText, 'FAIL', bodyProblems);
    skipped += 1;
    continue;
  }
  const errors = [...bodyProblems];
  validate(sample(responseSchema), expected, '$', errors);
  sampled += 1;
  report(label, typeText, 'spec', errors);
}

console.log(`\ncontract check: ${checked} live + ${sampled} from the OpenAPI schema, ${failures} failing, ${skipped} without a JSON body`);
process.exit(failures === 0 ? 0 : 1);
