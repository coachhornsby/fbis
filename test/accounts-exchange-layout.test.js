import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const view = read("../src/features/accounts/AccountsView.jsx");
const poly = read("../src/features/accounts/PolymarketAccountPanel.jsx");
const header = read("../src/features/accounts/ExchangeBrandHeader.jsx");
const css = read("../src/features/accounts/accounts.css");

test("Accounts uses a two-provider comparison grid with Kalshi and Polymarket as peers", () => {
  assert.match(view, /className="accounts-exchange-grid"/);
  assert.match(view, /className="accounts-exchange-shell accounts-exchange-shell--kalshi"/);
  assert.match(view, /<PolymarketAccountPanel token=\{token\} \/>/);
  assert.match(poly, /accounts-exchange-shell--polymarket/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:1180px\)/);
  assert.match(css, /\.accounts-exchange-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
});

test("official green and blue colors and provider logos are configured and not synthesized", () => {
  assert.match(css, /accounts-exchange-shell--kalshi\{--accounts-accent:#00dd94/);
  assert.match(css, /accounts-exchange-shell--polymarket\{--accounts-accent:#2e5cff/);
  assert.match(header, /https:\/\/kalshi\.com\/favicon\.ico/);
  assert.match(header, /https:\/\/polymarket\.com\/images\/brand\/icon-blue\.png/);
  assert.match(header, /<img[\s\S]*?src=\{exchange\.logo\}/);
  assert.match(header, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(header, /className="accounts-brand-fallback"/);
});

test("shared unlock and operator-only, GET portfolio requests are preserved", () => {
  assert.match(view, /x-fbis-account-token/);
  assert.match(poly, /x-fbis-account-token/);
  assert.match(view, /fetch\("\/api\/kalshi-account"/);
  assert.match(poly, /fetch\("\/api\/polymarket-account"/);
  assert.match(view, /cache: "no-store"/);
  assert.match(poly, /cache: "no-store"/);
  assert.match(view, /<ExchangeBrandHeader provider="kalshi"/);
  assert.match(poly, /<ExchangeBrandHeader provider="polymarket"/);
  assert.match(view, /onRefresh=\{\(\) => load\(token\)\}/);
  assert.match(poly, /onRefresh=\{\(\) => load\(\)\}/);
  assert.match(header, /PRIVATE · READ ONLY/);
  assert.doesNotMatch(view + poly + header, /localStorage|sessionStorage|orderPlacement|sendOrder|cancelOrder/);
});

test("responsive branded cards avoid a horizontal page overflow", () => {
  assert.match(css, /\.accounts-exchange-shell\{[\s\S]*?min-width:0/);
  assert.match(css, /\.accounts-exchange-shell \.accounts-table-wrap\{min-width:0;width:100%;overscroll-behavior-x:contain\}/);
  assert.match(css, /@media\(max-width:540px\)/);
  assert.match(css, /\.accounts-exchange-shell \.accounts-kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});
