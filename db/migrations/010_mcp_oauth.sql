CREATE TABLE mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  redirect_uris jsonb NOT NULL CHECK (jsonb_typeof(redirect_uris) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mcp_oauth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  state text NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX mcp_oauth_requests_expiry ON mcp_oauth_requests(expires_at);

CREATE TABLE mcp_oauth_codes (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX mcp_oauth_codes_expiry ON mcp_oauth_codes(expires_at);

CREATE TABLE mcp_oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
  resource text NOT NULL,
  refresh_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  revoked_at timestamptz
);
CREATE INDEX mcp_oauth_grants_owner ON mcp_oauth_grants(user_id,created_at DESC);

CREATE TABLE mcp_oauth_refresh_history (
  token_hash text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE
);

CREATE TABLE mcp_oauth_access_tokens (
  token_hash text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES mcp_oauth_grants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);
CREATE INDEX mcp_oauth_access_grant ON mcp_oauth_access_tokens(grant_id);
