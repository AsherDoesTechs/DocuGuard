import { Platform } from "react-native";

export type AdminUiSettings = { autoSync: boolean; privacyMode: boolean };
const KEY = "docuguard.admin.ui.settings";
let mem: AdminUiSettings = { autoSync: true, privacyMode: true };
const listeners = new Set<() => void>();

function notify() { listeners.forEach((l) => l()); }
export function getAdminUiSettings(): AdminUiSettings { return mem; }
export function setAdminUiSettings(next: Partial<AdminUiSettings>) { mem = { ...mem, ...next }; try { if (Platform.OS === "web" && typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(mem)); } catch {} notify(); }
export function subscribeAdminUiSettings(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function loadAdminUiSettings() { try { if (Platform.OS === "web" && typeof localStorage !== "undefined") { const raw = localStorage.getItem(KEY); if (raw) mem = { ...mem, ...JSON.parse(raw) }; } } catch {} notify(); return mem; }
export function maskEmail(email?: string | null) { const e = String(email || ""); const at = e.indexOf("@"); if (at <= 1) return e ? "•••@•••" : "—"; return `${e.slice(0,1)}•••${e.slice(Math.max(1,at-1), at)}${e.slice(at)}`; }
