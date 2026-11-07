import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../index.js", import.meta.url)), "utf8");
const directive = (name) => {
  const m = src.match(new RegExp(`${name}: \\[([^\\]]*)\\]`));
  assert.ok(m, `${name} directive not found`);
  return m[1];
};

test("the CSP lets Accept.js load, self-check and tokenize a card", () => {
  const script = directive("scriptSrc");
  assert.match(script, /"https:\/\/js\.authorize\.net"/);
  const connect = directive("connectSrc");
  for (const host of ["js.authorize.net", "jstest.authorize.net", "api2.authorize.net", "apitest.authorize.net"]) {
    assert.ok(connect.includes(`"https://${host}"`), `connectSrc is missing ${host}`);
  }
});

test("the CSP lets the hosted card forms post into their iframe and report back", () => {
  const form = directive("formAction");
  for (const host of ["accept.authorize.net", "test.authorize.net"]) {
    assert.ok(form.includes(`"https://${host}"`), `formAction is missing ${host}`);
  }
  assert.match(src, /IFrameCommunicator\.html[\s\S]{0,200}frame-ancestors 'self' https:\/\/accept\.authorize\.net https:\/\/test\.authorize\.net/);
  assert.match(src, /removeHeader\("X-Frame-Options"\)/);
});

