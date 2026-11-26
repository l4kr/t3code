import type { DevicePlatform } from "@t3tools/contracts";

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly cpuTimeMs: number;
  readonly cpuPercent: number;
  readonly memoryBytes: number;
  readonly command: string;
}

export interface FoundDevice {
  readonly platform: DevicePlatform;
  readonly id: string;
  readonly pid: number;
}

export const PS_ARGS = ["-axo", "pid=,ppid=,time=,%cpu=,rss=,command="] as const;

export const WINDOWS_EMULATOR_SCRIPT = [
  "Get-CimInstance Win32_Process -Filter \"Name LIKE 'qemu-system%'\" | ForEach-Object {",
  '  "$($_.ProcessId)`t$($_.ParentProcessId)`t$([int64](($_.KernelModeTime + $_.UserModeTime) / 10000))`t$($_.WorkingSetSize)`t$($_.CommandLine)"',
  "}",
].join("\n");

function parseCpuTime(value: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return undefined;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Math.round(
    (((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000,
  );
}

export function parsePsTable(stdout: string): ReadonlyArray<ProcessRow> {
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const cpuTimeMs = parseCpuTime(match[3] ?? "");
    if (cpuTimeMs === undefined) return [];
    return [
      {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        cpuTimeMs,
        cpuPercent: Number(match[4]),
        memoryBytes: Number(match[5]) * 1024,
        command: (match[6] ?? "").trim(),
      },
    ];
  });
}

export function parseWindowsProcessTable(stdout: string): ReadonlyArray<ProcessRow> {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const [pid, ppid, cpuTimeMs, memoryBytes, ...command] = line.split("\t");
    if (!pid || !/^\d+$/.test(pid)) return [];
    return [
      {
        pid: Number(pid),
        ppid: Number(ppid ?? 0),
        cpuTimeMs: Number(cpuTimeMs ?? 0),
        cpuPercent: 0,
        memoryBytes: Number(memoryBytes ?? 0),
        command: command.join("\t").trim(),
      },
    ];
  });
}

const SIMULATOR =
  /(?:^|\/)launchd_sim\s.*\/Devices\/([0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12})\//;
const EMULATOR = /(?:^|[\\/"])qemu-system-[\w.-]+?(?:\.exe)?"?(?:\s|$)/i;

export function findDevices(rows: ReadonlyArray<ProcessRow>): ReadonlyArray<FoundDevice> {
  return rows.flatMap((row): ReadonlyArray<FoundDevice> => {
    const simulator = SIMULATOR.exec(row.command);
    if (simulator?.[1]) return [{ platform: "ios", id: simulator[1], pid: row.pid }];
    if (!EMULATOR.test(row.command)) return [];
    const avd = /(?:^|\s)(?:-avd\s+|@)("?)([^\s"]+)\1/.exec(row.command)?.[2];
    return [{ platform: "android", id: avd ?? String(row.pid), pid: row.pid }];
  });
}

export function cpuPercentSince(
  previousMs: number | undefined,
  currentMs: number,
  elapsedMs: number,
): number | undefined {
  if (previousMs === undefined || elapsedMs <= 0 || currentMs < previousMs) return undefined;
  return ((currentMs - previousMs) / elapsedMs) * 100;
}

export function deviceUsage(
  rows: ReadonlyArray<ProcessRow>,
  rootPid: number,
  previousCpuTimeMs: ReadonlyMap<number, number>,
  elapsedMs: number,
) {
  const children = new Map<number, Array<ProcessRow>>();
  for (const row of rows) {
    const siblings = children.get(row.ppid);
    if (siblings) siblings.push(row);
    else children.set(row.ppid, [row]);
  }
  const root = rows.find((row) => row.pid === rootPid);
  const pids = new Set<number>();
  let cpuPercent = 0;
  let memoryBytes = 0;
  const visit = (row: ProcessRow) => {
    if (pids.has(row.pid)) return;
    pids.add(row.pid);
    cpuPercent +=
      cpuPercentSince(previousCpuTimeMs.get(row.pid), row.cpuTimeMs, elapsedMs) ?? row.cpuPercent;
    memoryBytes += row.memoryBytes;
    for (const child of children.get(row.pid) ?? []) visit(child);
  };
  if (root) visit(root);
  return { cpuPercent, memoryBytes, pids };
}
