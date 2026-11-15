-- INDRA LOADER — how a card draws its artwork
--
-- Applied to the shared project (`indra-hub`, ref cztyznuoferktewdhyji) as the
-- migration `loader_card_frame`. Kept here so the schema exists in the repository
-- rather than only in a dashboard.
--
-- A card is 232 pixels square and the picture behind the name is usually a poster with
-- its own type on it, which fights the product name printed over it. The film behind the
-- window has had a blur and a dim since 1.0.37; these are the same two dials, per
-- product, so one loud poster can be quietened without touching the rest of the shelf.
--
-- Both default to 0: every card drawn before this migration looks exactly as it did.
--
-- Safe to run again.

alter table public.loader_apps
  add column if not exists image_blur integer not null default 0,
  add column if not exists image_dim integer not null default 0;

alter table public.loader_apps
  drop constraint if exists loader_apps_image_blur_check,
  drop constraint if exists loader_apps_image_dim_check;

alter table public.loader_apps
  add constraint loader_apps_image_blur_check check (image_blur between 0 and 40),
  add constraint loader_apps_image_dim_check check (image_dim between 0 and 100);

comment on column public.loader_apps.image_blur is
  'Pixels of blur the loader draws over the card artwork. 0 is sharp.';
comment on column public.loader_apps.image_dim is
  'Percent of dark the loader lays over the card artwork. 0 is untouched.';
