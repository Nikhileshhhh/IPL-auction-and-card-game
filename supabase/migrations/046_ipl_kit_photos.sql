-- 046: strict card data (ADR-019). Every published card shows a photo of the
-- player in IPL franchise jersey, confirmed by the uploader/importer.
ALTER TABLE app_private.media_assets
  ADD COLUMN ipl_kit boolean NOT NULL DEFAULT false;
-- Original demo illustrations are never IPL-kit photos.
ALTER TABLE app_private.media_assets
  ADD CONSTRAINT media_assets_generated_not_kit CHECK (NOT (ipl_kit AND rights_basis = 'original-generated'));
