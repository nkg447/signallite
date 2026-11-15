import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("./chat.html", import.meta.url), "utf8");
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/import WebRTCClient from ['"].*?['"];/, "");

function startPage(href, { qrAvailable = true } = {}) {
  const elements = new Map();
  const clients = [];
  const errors = [];
  const qrLinks = [];
  const location = new URL(href);
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          textContent: "",
          disabled: false,
          hidden: false,
          style: {},
          classList: { toggle() {} },
          addEventListener() {},
        });
      }
      return elements.get(id);
    },
  };
  class Client {
    constructor(server, channel) {
      this.server = server;
      this.channel = channel;
      clients.push(this);
    }
    createOffer() { this.offerCreated = true; }
  }
  const context = {
    window: { location },
    document,
    URL,
    URLSearchParams,
    WebRTCClient: Client,
    console: { error: (...args) => errors.push(args), log() {} },
  };
  if (qrAvailable) {
    context.QRCode = { toCanvas: (_canvas, link) => qrLinks.push(link) };
  }
  vm.runInNewContext(script, context);
  return { elements, clients, errors, qrLinks };
}

test("uses relative client and a versioned Socket.IO module", () => {
  assert.match(html, /import WebRTCClient from ['"]\.\/WebRTCClient\.js['"]/);
  assert.match(html, /"socket\.io-client":\s*"https:\/\/cdn\.socket\.io\/4\.8\.1\/socket\.io\.esm\.min\.js"/);
});

test("GitHub Pages uses hosted signaling and retains its project path", () => {
  const result = startPage("https://nkg447.github.io/signallite/chat.html");
  assert.equal(result.clients[0].server, "https://signallite.nikunjgupta.dev");
  assert.equal(result.clients[0].offerCreated, true);
  const invite = new URL(result.elements.get("invite-link").textContent);
  assert.equal(invite.pathname, "/signallite/chat.html");
  assert.equal(invite.searchParams.get("channel"), result.clients[0].channel);
  assert.deepEqual(result.qrLinks, [invite.href]);
  const joiner = startPage(invite.href);
  assert.equal(joiner.clients[0].server, result.clients[0].server);
  assert.equal(joiner.clients[0].channel, result.clients[0].channel);
  assert.equal(joiner.clients[0].offerCreated, undefined);
});

test("all hosting origins use the configured signaling server", () => {
  for (const origin of ["http://localhost:3000", "https://myapp.example", "https://nikunjgupta.dev", "https://nkg447.github.io"]) {
    const result = startPage(`${origin}/chat.html`);
    assert.equal(result.clients[0].server, "https://signallite.nikunjgupta.dev");
  }
});

test("legacy links for the configured server still work", () => {
  const result = startPage("https://myapp.example/chat.html?server=https%3A%2F%2Fsignallite.nikunjgupta.dev");
  assert.equal(result.clients[0].server, "https://signallite.nikunjgupta.dev");
  const invite = new URL(result.elements.get("invite-link").textContent);
  assert.equal(invite.searchParams.has("server"), false);
  const joiner = startPage(invite.href);
  assert.equal(joiner.clients[0].server, result.clients[0].server);
  assert.equal(joiner.clients[0].channel, result.clients[0].channel);
  const legacyJoiner = startPage("https://myapp.example/chat.html?channel=old-room&server=https%3A%2F%2Fsignallite.nikunjgupta.dev");
  assert.equal(legacyJoiner.clients[0].server, "https://signallite.nikunjgupta.dev");
  assert.equal(legacyJoiner.clients[0].channel, "old-room");
});

test("unsupported server parameters display an error without connecting", () => {
  for (const value of ["", "invalid", "http://insecure.example", "https://signal.example", "https://signallite.nikunjgupta.dev/path", "https://signallite.nikunjgupta.dev/?query=1"]) {
    const result = startPage(`https://myapp.example/chat.html?server=${encodeURIComponent(value)}`);
    assert.equal(result.clients.length, 0, value);
    assert.equal(result.elements.get("status-text").textContent, "Configuration error", value);
    assert.equal(result.elements.get("setup-title").textContent, "Unsupported signaling server", value);
    assert.equal(result.errors.length, 1, value);
  }
  const duplicate = startPage("https://myapp.example/chat.html?server=https%3A%2F%2Fsignallite.nikunjgupta.dev&server=https%3A%2F%2Fsignal.example");
  assert.equal(duplicate.clients.length, 0);
  assert.equal(duplicate.errors.length, 1);
});

test("a missing QR library does not prevent connecting or sharing a link", () => {
  const result = startPage("http://localhost:3000/chat.html", { qrAvailable: false });
  assert.equal(result.clients.length, 1);
  assert.ok(result.elements.get("invite-link").textContent);
  assert.equal(result.errors.length, 1);
});
