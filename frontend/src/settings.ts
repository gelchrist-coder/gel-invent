import { useEffect, useState } from "react";
import { DEFAULT_EFFECTIVE_CAPABILITIES, fetchSystemSettings, SystemSettings, type CapabilityKey, type CapabilityMap } from "./api";

const DEFAULT_SETTINGS: SystemSettings = {
  low_stock_threshold: 10,
  expiry_warning_days: 45,
  uses_expiry_tracking: true,
  capability_overrides: {},
  effective_capabilities: { ...DEFAULT_EFFECTIVE_CAPABILITIES },
  currency_code: "GHS",
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

export const useCapabilities = (): CapabilityMap => {
  const settings = useSystemSettings();
  return settings.effective_capabilities ?? DEFAULT_EFFECTIVE_CAPABILITIES;
};

export const useCapability = (key: CapabilityKey): boolean => {
  const capabilities = useCapabilities();
  return Boolean(capabilities[key]);
};

export const useExpiryTracking = (): boolean => {
  return useCapability("expiry_tracking");
};
