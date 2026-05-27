export type StoredUser = {
  id?: number;
  name?: string;
  email?: string;
  phone?: string | null;
  business_name?: string;
  business_logo_url?: string | null;
  role?: string;
  branch_id?: number | null;
};

export function readStoredUser(): StoredUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}