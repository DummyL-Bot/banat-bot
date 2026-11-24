"use strict";

// Run: npm test   (o: node --test bot/bot-config.test.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const cfg = require("./bot-config");

function lockedConfig(extra = {}) {
  return cfg.normalizeConfig({
    gcLock: { enabled: true, name: "Tropa GC", threadID: "111222333", matchedName: "Tropa GC" },
    ...extra
  });
}

test("Messenger !banat commands are disabled by default (dashboard is the control)", () => {
  const c = cfg.defaultConfig();
  for (const sub of ["on", "off", "toggle", "status", "help"]) {
    assert.equal(cfg.isMessengerCommandAllowed(c, sub), false);
  }
});

test("A command switched on in the dashboard is allowed in Messenger", () => {
  const c = cfg.normalizeConfig({ messengerCommands: { status: true } });
  assert.equal(cfg.isMessengerCommandAllowed(c, "status"), true);
  assert.equal(cfg.isMessengerCommandAllowed(c, "on"), false);
});

test("Command aliases map to the five dashboard commands", () => {
  assert.equal(cfg.parseBanatSubcommand("!banat enable"), "on");
  assert.equal(cfg.parseBanatSubcommand("!banat stop"), "off");
  assert.equal(cfg.parseBanatSubcommand("!banat"), "status");
  assert.equal(cfg.parseBanatSubcommand("!banat whatever"), null);
});

test("With GC Auto Lock, only the locked GC is answered", () => {
  const c = lockedConfig();
  assert.equal(cfg.isThreadAllowed(c, "111222333"), true);
  assert.equal(cfg.isThreadAllowed(c, "999888777"), false);
});

test("Locked but not yet found GC answers no thread", () => {
  const c = cfg.normalizeConfig({ gcLock: { enabled: true, name: "Tropa GC" } });
  assert.equal(cfg.isThreadAllowed(c, "111222333"), false);
});

test("Without GC Auto Lock, every thread is allowed", () => {
  assert.equal(cfg.isThreadAllowed(cfg.defaultConfig(), "999888777"), true);
});

test("GC name matching ignores case and extra spaces", () => {
  assert.equal(cfg.sameGcName("  tropa   gc ", "Tropa GC"), true);
  assert.equal(cfg.sameGcName("Tropa GC 2", "Tropa GC"), false);
});

test("Auto Change GC Name defaults to every 2 minutes", () => {
  assert.equal(cfg.defaultConfig().gcRename.intervalMinutes, 2);
});

test("Rename is due after 2 minutes, not before", () => {
  const last = Date.parse("2026-01-01T00:00:00Z");
  const c = lockedConfig({ gcRename: { enabled: true, lastRenamedAt: new Date(last).toISOString() } });
  assert.equal(cfg.isRenameDue(c, last + 119 * 1000), false);
  assert.equal(cfg.isRenameDue(c, last + 120 * 1000), true);
});

test("Rename never runs without a found locked GC", () => {
  const c = cfg.normalizeConfig({ gcLock: { enabled: true, name: "Tropa GC" }, gcRename: { enabled: true } });
  assert.equal(cfg.isRenameDue(c), false);
});

test("Pattern mode counts up using the locked GC name", () => {
  const c = lockedConfig({ gcRename: { enabled: true, pattern: "{name} #{n}", counter: 4 } });
  assert.deepEqual(cfg.buildNextGcName(c), { name: "Tropa GC #5", patch: { counter: 5 } });
});

test("Rotation mode cycles through the list and wraps around", () => {
  const c = lockedConfig({ gcRename: { enabled: true, mode: "rotation", names: ["A", "B"], rotationIndex: 1 } });
  assert.deepEqual(cfg.buildNextGcName(c), { name: "B", patch: { rotationIndex: 0 } });
});

test("Rename interval cannot go below 1 minute", () => {
  assert.equal(cfg.clampInterval(0), 1);
  assert.equal(cfg.clampInterval("5"), 5);
});

test("Facebook profile link parser handles profile.php?id=, people/, vanity URLs, and raw UIDs", () => {
  const byQuery = cfg.parseFacebookProfileInput("https://www.facebook.com/profile.php?id=100012345678901&mibextid=ZbWKwL");
  assert.equal(byQuery.valid, true);
  assert.equal(byQuery.userID, "100012345678901");
  assert.equal(byQuery.username, null);

  const byPeople = cfg.parseFacebookProfileInput("https://www.facebook.com/people/Juan-Dela-Cruz/100099988877766/");
  assert.equal(byPeople.valid, true);
  assert.equal(byPeople.userID, "100099988877766");

  const byVanity = cfg.parseFacebookProfileInput("https://m.facebook.com/juan.delacruz?mibextid=123");
  assert.equal(byVanity.valid, true);
  assert.equal(byVanity.userID, null);
  assert.equal(byVanity.username, "juan.delacruz");

  const byRaw = cfg.parseFacebookProfileInput("100012345678901");
  assert.equal(byRaw.valid, true);
  assert.equal(byRaw.userID, "100012345678901");

  const invalid = cfg.parseFacebookProfileInput("https://google.com/juan");
  assert.equal(invalid.valid, false);
});

test("Target user matching filters to only the targeted user when enabled", () => {
  const c = cfg.normalizeConfig({
    targetUser: {
      enabled: true,
      profileUrl: "https://www.facebook.com/profile.php?id=100011122233344",
      userID: "100011122233344"
    }
  });
  assert.equal(cfg.isTargetUserRestricted(c), true);
  assert.equal(cfg.matchesTargetUser(c, "100011122233344"), true);
  assert.equal(cfg.matchesTargetUser(c, "100099999999999"), false);

  const byVanity = cfg.normalizeConfig({
    targetUser: {
      enabled: true,
      profileUrl: "https://www.facebook.com/juan.delacruz"
    }
  });
  assert.equal(cfg.matchesTargetUser(byVanity, "1000555", { vanity: "Juan.DelaCruz" }), true);
  assert.equal(cfg.matchesTargetUser(byVanity, "1000666", { vanity: "other.user" }), false);
});

test("Fast attack defaults to 2 seconds and clamps between 1 and 60 seconds", () => {
  assert.equal(cfg.defaultConfig().fastAttack.intervalSeconds, 2);
  assert.equal(cfg.defaultConfig().fastAttack.enabled, false);
  assert.equal(cfg.clampFastAttackSeconds(0), 1);
  assert.equal(cfg.clampFastAttackSeconds(2), 2);
  assert.equal(cfg.clampFastAttackSeconds(120), 60);
});
