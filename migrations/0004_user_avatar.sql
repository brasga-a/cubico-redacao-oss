-- Migration 0004: custom profile photo stored in R2 (additive).
-- `image` keeps the Google profile URL; `avatarKey` points to the uploaded object, if any.
ALTER TABLE user ADD COLUMN avatarKey TEXT;
