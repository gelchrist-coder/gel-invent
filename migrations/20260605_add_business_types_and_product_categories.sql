-- Phase 1: separate business types from product categories on the owner profile.
-- Keep legacy `categories` in place for compatibility during rollout.
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_types TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS product_categories TEXT;
