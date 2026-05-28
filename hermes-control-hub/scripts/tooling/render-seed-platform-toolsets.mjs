#!/usr/bin/env node
/**
 * Regenerate platform_toolsets blocks in seed config.yaml files from
 * data/seed/shared/full-toolset-ids.json (all tools on all gateways).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const ids = JSON.parse(
  readFileSync(join(ROOT, "data/seed/shared/full-toolset-ids.json"), "utf-8"),
);

const PLATFORMS_CH = [
  "cli",
  "discord",
  "telegram",
  "slack",
  "whatsapp",
  "signal",
  "homeassistant",
];
const PLATFORMS_ROOT = [...PLATFORMS_CH, "qqbot"];

function renderPlatformToolsets(platforms) {
  const lines = ["platform_toolsets:"];
  for (const plat of platforms) {
    lines.push(`  ${plat}:`);
    for (const id of ids) {
      lines.push(`    - ${id}`);
    }
  }
  return lines.join("\n");
}

function replacePlatformToolsets(configPath, platforms) {
  const text = readFileSync(configPath, "utf-8");
  const start = text.indexOf("platform_toolsets:");
  if (start === -1) {
    throw new Error(`No platform_toolsets in ${configPath}`);
  }
  const after = text.slice(start);
  const endMatch = after.match(/\n(?=[a-z_]+:)/);
  const end = endMatch ? start + endMatch.index : text.length;
  const before = text.slice(0, start);
  const rest = text.slice(end).replace(/^\n/, "");
  const block = renderPlatformToolsets(platforms);
  writeFileSync(configPath, `${before}${block}\n${rest}`, "utf-8");
}

const manifest = JSON.parse(
  readFileSync(join(ROOT, "data/seed/profiles/manifest.json"), "utf-8"),
);
replacePlatformToolsets(join(ROOT, "data/seed/agent-root/config.yaml"), PLATFORMS_ROOT);
for (const { slug } of manifest.profiles) {
  const path = join(ROOT, "data/seed/profiles", slug, "config.yaml");
  if (!existsSync(path)) throw new Error(`Missing ${path}`);
  replacePlatformToolsets(path, PLATFORMS_CH);
}
console.log("Updated platform_toolsets in agent-root and", manifest.profiles.length, "profiles");
