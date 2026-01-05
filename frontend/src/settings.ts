import { useEffect, useState } from "react";
import { fetchSystemSettings, SystemSettings } from "./api";

const DEFAULT_SETTINGS: SystemSettings = {
  low_stock_threshold: 10,
  expiry_warning_days: 180,
  uses_expiry_tracking: true,
  auto_backup: true,
  email_notifications: false,
};

// Cache the settings to avoid repeated API calls
let cachedSettings: SystemSettings | null = null;
let fetchPromise: Promise<SystemSettings> | null = null;

const loadSettings = async (): Promise<SystemSettings> => {
  if (cachedSettings) return cachedSettings;
  
  if (!fetchPromise) {
    fetchPromise = fetchSystemSettings()
      .then((settings) => {
        cachedSettings = settings;
        return settings;
      })
      .catch(() => {
        return DEFAULT_SETTINGS;
      })
      .finally(() => {
        fetchPromise = null;
      });
  }
  
  return fetchPromise;
};

export const clearSettingsCache = () => {
  cachedSettings = null;
  fetchPromise = null;
};

// Get settings synchronously if cached
export const getCachedSettings = (): SystemSettings | null => cachedSettings;

export const useSystemSettings = (): SystemSettings => {
  const [settings, setSettings] = useState<SystemSettings>(() => cachedSettings || DEFAULT_SETTINGS);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    loadSettings().then(setSettings);

    // Listen for settings changes (when user updates in Profile page)
    const handleSettingsChanged = (e: Event) => {
      const customEvent = e as CustomEvent<SystemSettings>;
      if (customEvent.detail) {
        cachedSettings = customEvent.detail;
        setSettings(customEvent.detail);
      }
    };

    window.addEventListener("systemSettingsChanged", handleSettingsChanged);

    return () => {
      window.removeEventListener("systemSettingsChanged", handleSettingsChanged);
    };
  }, []);

  return settings;
};

// Convenience hook for just the expiry tracking setting
export const useExpiryTracking = (): boolean => {
  const settings = useSystemSettings();
  return settings.uses_expiry_tracking;
};
