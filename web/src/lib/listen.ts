export function listenPort(listen: string): string {
  const p = listen.trim().split(":").pop() ?? "";
  return /^\d+$/.test(p) && p !== "0" ? p : "443";
}

export function setListenPort(listen: string, port: string): string {
  const l = listen.trim();
  const i = l.lastIndexOf(":");
  return `${i >= 0 ? l.slice(0, i) : l}:${port}`;
}
