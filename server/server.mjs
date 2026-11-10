#!/usr/bin/env node
/**
 * Video Tools — servidor local
 *
 * Faz a ponte entre o site (GitHub Pages) e o yt-dlp instalado no seu computador.
 * Não tem dependências: só precisa do Node.js 18+, do yt-dlp e (recomendado) do ffmpeg.
 *
 *   node server.mjs            → escuta em http://127.0.0.1:5123
 *   PORT=6000 node server.mjs  → outra porta
 *
 * Segurança: só escuta no 127.0.0.1 (não fica exposto na rede) e só aceita
 * pedidos vindos do site oficial ou do ambiente de desenvolvimento.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 5123;
const IS_WIN = process.platform === "win32";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK_DIR = path.join(os.tmpdir(), "video-tools-server");
const JOB_TTL_MS = 60 * 60 * 1000; // arquivos temporários somem 1h depois de prontos

const ALLOWED_ORIGINS = new Set([
  "https://valcanaia282.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  ...(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);

const FORMATS = {
  mp4: ["-f", "bv*+ba/b", "-S", "res,ext:mp4:m4a", "--merge-output-format", "mp4"],
  best: ["-f", "bv*+ba/b"],
  mp3: ["-x", "--audio-format", "mp3", "--audio-quality", "0"],
};

const MIME = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".opus": "audio/ogg",
  ".ogg": "audio/ogg", ".wav": "audio/wav", ".gif": "image/gif",
};

// ------------------------------------------------------------ ferramentas
function findExe(name, envVar) {
  if (process.env[envVar] && existsSync(process.env[envVar])) return process.env[envVar];
  const exts = IS_WIN ? [".exe", ".cmd", ".bat", ""] : [""];
  const dirs = [HERE, path.join(HERE, "bin"), ...(process.env.PATH || "").split(path.delimiter)];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      try {
        if (statSync(full).isFile()) return full;
      } catch { /* não existe */ }
    }
  }
  return null;
}

function toolVersion(exe, args) {
  if (!exe) return null;
  try {
    const r = spawnSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 15000 });
    return (r.stdout || "").split(/\r?\n/)[0].trim() || null;
  } catch {
    return null;
  }
}

const tools = { ytdlp: null, ytdlpVersion: null, ffmpeg: null, ffmpegVersion: null };
function detectTools() {
  tools.ytdlp = findExe("yt-dlp", "YTDLP_PATH");
  tools.ytdlpVersion = toolVersion(tools.ytdlp, ["--version"]);
  tools.ffmpeg = findExe("ffmpeg", "FFMPEG_PATH");
  const v = toolVersion(tools.ffmpeg, ["-version"]);
  tools.ffmpegVersion = v ? (v.match(/ffmpeg version (\S+)/) || [])[1] || v : null;
}

// ------------------------------------------------------------ jobs
/** @type {Map<string, any>} */
const jobs = new Map();

function parseTime(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parts = String(value).trim().replace(",", ".").split(":");
  if (parts.length > 3 || parts.some((p) => p.trim() === "" || isNaN(Number(p)))) throw new Error("Tempo inválido: " + value);
  const secs = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  if (secs < 0) throw new Error("Tempo inválido: " + value);
  return secs;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status, // running | done | error | cancelled
    phase: job.phase,
    progress: job.progress,
    detail: job.detail,
    error: job.error,
    filename: job.file ? path.basename(job.file) : null,
    size: job.file ? job.size : null,
    log: job.log.slice(-15),
  };
}

function finishedFile(dir) {
  const skip = /\.(part|ytdl|temp|tmp)$|\.part-Frag\d+$|\.f\d+\.\w+$/i;
  let best = null;
  for (const name of readdirSync(dir)) {
    if (skip.test(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isFile() && (!best || st.size > best.size)) best = { full, size: st.size };
  }
  return best;
}

function startJob({ url, format = "mp4", start, end }) {
  if (!tools.ytdlp) detectTools();
  if (!tools.ytdlp) throw new Error("yt-dlp não encontrado neste computador. Instale com: winget install yt-dlp.yt-dlp");
  if (typeof url !== "string" || !/^https?:\/\/\S+$/i.test(url.trim())) throw new Error("Link inválido.");
  if (!FORMATS[format]) throw new Error("Formato inválido.");
  const s = parseTime(start);
  const e = parseTime(end);
  if (s !== null && e !== null && e <= s) throw new Error("O fim do trecho precisa ser depois do início.");

  const id = randomUUID();
  const dir = path.join(WORK_DIR, id);
  mkdirSync(dir, { recursive: true });

  const args = [
    "--newline", "--no-color", "--no-playlist", "--no-mtime", "--progress",
    "-P", dir, "-o", "%(title).150B [%(id)s].%(ext)s",
    ...FORMATS[format],
  ];
  if (tools.ffmpeg) args.push("--ffmpeg-location", tools.ffmpeg);
  if (s !== null || e !== null) {
    args.push("--download-sections", `*${s ?? 0}-${e ?? "inf"}`, "--force-keyframes-at-cuts");
  }
  args.push("--", url.trim());

  const job = { id, dir, status: "running", phase: "Conectando…", progress: 0, detail: "", error: null, file: null, size: 0, log: [], proc: null, doneAt: 0 };
  jobs.set(id, job);

  const proc = spawn(tools.ytdlp, args, {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  job.proc = proc;

  const progressRe = /^\[download\]\s+([\d.]+)%(.*)$/;
  let buffer = "";
  const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n|\r/);
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(progressRe);
      if (m) {
        job.progress = Math.min(100, parseFloat(m[1]));
        job.phase = "Baixando…";
        job.detail = m[2].trim().replace(/\s+/g, " ");
        continue;
      }
      if (/^\[download\] (Destination|Downloading)/.test(line) && job.phase === "Conectando…") job.phase = "Baixando…";
      if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM3u8|VideoRemuxer)\]/.test(line)) job.phase = "Processando com ffmpeg…";
      if (line.startsWith("ERROR")) job.error = line.replace(/^ERROR:\s*/, "");
      job.log.push(line);
      if (job.log.length > 200) job.log.shift();
    }
  };
  proc.stdout.on("data", onData);
  proc.stderr.on("data", onData);

  proc.on("error", (err) => {
    job.status = "error";
    job.error = "Falha ao executar o yt-dlp: " + err.message;
    job.doneAt = Date.now();
  });
  proc.on("close", (code) => {
    job.proc = null;
    job.doneAt = Date.now();
    if (job.status === "cancelled") return;
    if (code === 0) {
      const f = finishedFile(dir);
      if (f) {
        job.status = "done";
        job.phase = "Pronto";
        job.progress = 100;
        job.file = f.full;
        job.size = f.size;
        return;
      }
      job.error = "O yt-dlp terminou, mas nenhum arquivo foi gerado.";
    }
    job.status = "error";
    job.error = job.error || `yt-dlp terminou com código ${code}.`;
  });

  return job;
}

function removeJob(job) {
  if (job.proc) {
    job.status = "cancelled";
    try { job.proc.kill(); } catch { /* ignore */ }
  }
  setTimeout(() => {
    try { rmSync(job.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }, 1500);
  jobs.delete(job.id);
}

setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.doneAt && now - job.doneAt > JOB_TTL_MS) removeJob(job);
  }
}, 5 * 60 * 1000).unref();

// ------------------------------------------------------------ HTTP
function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024) reject(new Error("Corpo muito grande."));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("JSON inválido.")); }
    });
    req.on("error", reject);
  });
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);
  const url = new URL(req.url || "/", `http://${HOST}`);

  if (req.method === "OPTIONS") {
    res.writeHead(origin && ALLOWED_ORIGINS.has(origin) ? 204 : 403, cors);
    return res.end();
  }
  // Pedidos vindos de outros sites são recusados. Sem Origin (ex.: abrir o link direto) só GET.
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: "Origem não permitida: " + origin });
  if (!origin && req.method !== "GET") return send(res, 403, { error: "Origem ausente." });

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      if (!tools.ytdlp || !tools.ffmpeg) detectTools();
      return send(res, 200, {
        ok: true, app: "video-tools-server", version: VERSION,
        ytdlp: tools.ytdlpVersion, ffmpeg: tools.ffmpegVersion,
      }, cors);
    }

    if (req.method === "POST" && url.pathname === "/api/jobs") {
      if (!String(req.headers["content-type"] || "").includes("application/json")) {
        return send(res, 415, { error: "Use application/json." }, cors);
      }
      const body = await readJson(req);
      const job = startJob(body);
      return send(res, 201, publicJob(job), cors);
    }

    const m = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/file)?$/);
    if (m) {
      const job = jobs.get(m[1]);
      if (!job) return send(res, 404, { error: "Tarefa não encontrada." }, cors);

      if (req.method === "DELETE" && !m[2]) {
        removeJob(job);
        return send(res, 200, { ok: true }, cors);
      }
      if (req.method === "GET" && !m[2]) return send(res, 200, publicJob(job), cors);
      if (req.method === "GET" && m[2]) {
        if (job.status !== "done" || !job.file || !existsSync(job.file)) {
          return send(res, 409, { error: "O arquivo ainda não está pronto." }, cors);
        }
        const name = path.basename(job.file);
        res.writeHead(200, {
          ...cors,
          "Content-Type": MIME[path.extname(name).toLowerCase()] || "application/octet-stream",
          "Content-Length": statSync(job.file).size,
          "Content-Disposition": contentDisposition(name),
          "Cache-Control": "no-store",
        });
        createReadStream(job.file).pipe(res);
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Servidor do Video Tools rodando. Abra https://valcanaia282.github.io/video-tools/\n");
    }
    send(res, 404, { error: "Não encontrado." }, cors);
  } catch (err) {
    send(res, 400, { error: err instanceof Error ? err.message : String(err) }, cors);
  }
});

// ------------------------------------------------------------ início
try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
mkdirSync(WORK_DIR, { recursive: true });
detectTools();

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nA porta ${PORT} já está em uso. O servidor provavelmente já está aberto em outra janela.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  Video Tools — servidor local");
  console.log(`  Endereço: http://${HOST}:${PORT}`);
  console.log(`  yt-dlp:   ${tools.ytdlpVersion ? `${tools.ytdlpVersion}  (${tools.ytdlp})` : "NÃO ENCONTRADO → winget install yt-dlp.yt-dlp"}`);
  console.log(`  ffmpeg:   ${tools.ffmpegVersion ? tools.ffmpegVersion : "NÃO ENCONTRADO → winget install Gyan.FFmpeg"}`);
  console.log("");
  console.log("  Agora abra o site: https://valcanaia282.github.io/video-tools/");
  console.log("  Deixe esta janela aberta enquanto estiver usando. Ctrl+C para encerrar.");
  console.log("");
});

const shutdown = () => {
  for (const job of jobs.values()) if (job.proc) try { job.proc.kill(); } catch { /* ignore */ }
  try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
