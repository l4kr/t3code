import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export function readAsar(file) {
  const buf = NodeFS.readFileSync(file);
  const headerPickleSize = buf.readUInt32LE(4);
  const jsonLength = buf.readInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + jsonLength).toString("utf8"));
  return { header, data: buf.subarray(8 + headerPickleSize) };
}

function findNode(archive, nodePath) {
  let node = archive.header;
  for (const part of nodePath.split(/[\\/]/).filter(Boolean)) {
    node = node.files?.[part];
    if (!node) throw new Error(`${nodePath} not found in asar`);
  }
  return node;
}

function fileNode(archive, filePath) {
  const node = findNode(archive, filePath);
  if (node.files) throw new Error(`${filePath} is a directory`);
  if (node.unpacked) throw new Error(`${filePath} is unpacked; cannot patch in place`);
  return node;
}

function contentOf(archive, node) {
  if (node.content) return node.content;
  const offset = Number(node.offset);
  return archive.data.subarray(offset, offset + node.size);
}

export function readAsarFile(archive, filePath) {
  return contentOf(archive, fileNode(archive, filePath));
}

function newFileNode(content, integrity) {
  const blockSize = integrity?.blockSize ?? 4 * 1024 * 1024;
  const blocks = [];
  for (let i = 0; i < Math.max(content.length, 1); i += blockSize) {
    blocks.push(sha256(content.subarray(i, i + blockSize)));
  }
  return {
    size: content.length,
    content,
    integrity: { algorithm: "SHA256", hash: sha256(content), blockSize, blocks },
  };
}

export function replaceAsarFile(archive, filePath, content) {
  const node = fileNode(archive, filePath);
  Object.assign(node, newFileNode(content, node.integrity));
}

export function listAsarDir(archive, dirPath) {
  const out = [];
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files)) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (child.files) walk(child, rel);
      else if (!child.unpacked && !child.link) out.push(rel);
    }
  };
  walk(findNode(archive, dirPath), "");
  return out;
}

export function replaceAsarDir(archive, dirPath, sourceDir) {
  const parts = dirPath.split(/[\\/]/).filter(Boolean);
  const parent = findNode(archive, parts.slice(0, -1).join("/"));
  const name = parts.at(-1);
  if (!parent.files?.[name]?.files) throw new Error(`${dirPath} is not a directory in asar`);
  const build = (dir) => {
    const node = { files: {} };
    for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
      const full = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) node.files[entry.name] = build(full);
      else if (entry.isFile()) node.files[entry.name] = newFileNode(NodeFS.readFileSync(full));
      else throw new Error(`Unsupported entry ${full}`);
    }
    return node;
  };
  parent.files[name] = build(sourceDir);
}

export function writeAsar(file, archive) {
  const chunks = [];
  let offset = 0;
  const pack = (node) => {
    for (const child of Object.values(node.files ?? {})) {
      if (child.files) {
        pack(child);
        continue;
      }
      if (child.unpacked || child.link) continue;
      const content = contentOf(archive, child);
      delete child.content;
      child.offset = String(offset);
      child.size = content.length;
      chunks.push(content);
      offset += content.length;
    }
  };
  pack(archive.header);
  const json = Buffer.from(JSON.stringify(archive.header), "utf8");
  const padded = Math.ceil(json.length / 4) * 4;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  NodeFS.writeFileSync(file, Buffer.concat([sizePickle, headerPickle, ...chunks]));
}

function sha256(buffer) {
  return NodeCrypto.createHash("sha256").update(buffer).digest("hex");
}
