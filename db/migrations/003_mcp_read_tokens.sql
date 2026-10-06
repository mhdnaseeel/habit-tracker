CREATE TABLE mcp_read_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 label varchar(100) NOT NULL CHECK(length(trim(label))>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
 revoked_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE INDEX mcp_read_tokens_owner ON mcp_read_tokens(user_id,created_at DESC);
