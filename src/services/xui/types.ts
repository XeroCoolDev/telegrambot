export interface XuiUser {
  id: string;
  username: string;
  credits: string; // XUI returns credits as string
  api_key: string;
  reseller_dns: string;
}

export interface XuiLine {
  id: string;
  username: string;
  password: string;
  exp_date: string | number | null; // unix timestamp (string from get_lines, number from get_line)
  max_connections: string;
  bouquet: string; // JSON array string (only from get_line)
  allowed_outputs: string; // JSON array string (only from get_line)
  member_id: string;
  admin_notes: string;
  reseller_notes: string;
  contact: string;
  force_server_id: string;
  is_trial: string;
  last_ip: string | null;
  enabled: string; // "0" | "1" from get_lines
  admin_enabled: string; // "0" | "1" from get_lines
  status: number; // 0 | 1 from get_line
  created_at: string;
}

export interface XuiPackage {
  id: string;
  package_name: string;
  official_credits: string;
  official_duration: string;
  official_duration_in: string; // "months" | "days" | "hours"
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
