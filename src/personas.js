// Loads every persona from /personas/*.md.
// Each file = front matter (key: value lines between ---) + a markdown body that becomes the seat's instructions.
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve("personas");

function parse(file) {
  const raw = fs.readFileSync(path.join(DIR, file), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`Persona ${file} has no front matter`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    id: meta.id,
    name: meta.name,
    initials: meta.initials || meta.name.split(" ").map((w) => w[0]).join("").slice(0, 2),
    title: meta.title || "",
    lens: meta.lens || "",
    color: meta.color || "#455a64",
    kind: meta.kind || "member",
    order: Number(meta.order || 50),
    inspiredBy: meta.inspiredBy || "",
    demoWeights: (meta.demoWeights || "3,4,3").split(",").map(Number),
    file,
    prompt: m[2].trim(),
  };
}

export function loadPersonas() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map(parse)
    .sort((a, b) => a.order - b.order);
}

export function getPersona(id) {
  return loadPersonas().find((p) => p.id === id);
}
