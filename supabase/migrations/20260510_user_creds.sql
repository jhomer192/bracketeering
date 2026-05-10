-- Bracketeering: per-user Spotify Developer App credentials.
-- BYO Client ID model — each user supplies their own Spotify Client ID + Secret
-- to sidestep Spotify Dev Mode's 5-user cap. Secret is encrypted at rest with
-- AES-256-GCM (key in BYO_ENCRYPTION_KEY env var, server-side only).

create table if not exists bracketeering_user_creds (
  spotify_user_id text primary key,
  display_name    text,
  client_id       text not null,
  client_secret_encrypted text not null,  -- "iv_b64:authtag_b64:ciphertext_b64"
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists bracketeering_user_creds_client_id_idx
  on bracketeering_user_creds (client_id);

-- No RLS: this table is only accessed server-side via SUPABASE_SERVICE_ROLE_KEY.
-- The anon key has no grants on it.
revoke all on bracketeering_user_creds from anon, authenticated;
