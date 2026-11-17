/**
 * Internal panel shapes. They are string-typed because they were modelled on
 * xui.one's API; the XUI.live Engine objects are mapped onto them in
 * engine.ts so the rest of the bot is unchanged.
 */
export interface XuiUser {
  id: string;
  username: string;
  credits: string; // whole or decimal number as text, e.g. "12" or "12.5"
  api_key: string; // the reseller's key as stored by the bot; never returned by the panel
  reseller_dns: string;
}

export interface XuiLine {
  id: string;
  username: string;
  password: string;
  exp_date: string | number | null; // unix timestamp, null = never expires
  max_connections: string;
  bouquet: string; // JSON array string of bouquet ids
  allowed_outputs: string; // JSON array string ("ts", "m3u8", "rtmp")
  member_id: string; // owning account id
  admin_notes: string;
  reseller_notes: string;
  contact: string;
  force_server_id: string;
  is_trial: string; // "0" | "1"
  last_ip: string | null;
  enabled: string; // "0" | "1" — the line's own switch
  admin_enabled: string; // "0" | "1" — "0" when an administrator banned it
  status: number; // 1 when enabled and not banned
  created_at: string;
}

export interface XuiPackage {
  id: string;
  package_name: string;
  official_credits: string;
  official_duration: string;
  official_duration_in: string; // "hours" | "days" | "months" | "years"
  max_connections: string;
  is_trial: string;
}

export interface ConnectionOption {
  from: number;
  to: number;
  cost: number;
  isDiscounted: boolean;
  multiplier: number;
}
