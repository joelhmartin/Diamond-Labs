import { test } from "vitest";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import StagingBanner from "./StagingBanner.jsx";

test("renders the fixed staging banner when env is staging", () => {
  const html = renderToStaticMarkup(<StagingBanner appEnv="staging" />);
  assert.match(html, /STAGING — test data, sandbox payments/);
  assert.match(html, /position:\s*fixed/);
});

test("renders nothing for any other env", () => {
  for (const v of [undefined, "", "production", "development"]) {
    assert.equal(renderToStaticMarkup(<StagingBanner appEnv={v} />), "");
  }
});
