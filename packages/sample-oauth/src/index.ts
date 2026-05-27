import Fastify from "fastify";

const app = Fastify({ logger: true });
const codes = new Map<string, { user: string; client: string }>();
const tokens = new Map<string, string>();

app.get("/authorize", async (request, reply) => {
  const { client_id, redirect_uri, state } = request.query as Record<string, string>;
  const code = Math.random().toString(36).substring(7);
  codes.set(code, { user: "demo-user", client: client_id });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", state);
  return reply.redirect(redirectUrl.toString());
});

app.post("/token", async (request) => {
  const { code } = request.body as { code: string };
  const token = Math.random().toString(36).substring(7);
  const data = codes.get(code);
  if (data) tokens.set(token, data.user);

  return {
    access_token: token,
    token_type: "Bearer",
    expires_in: 3600,
  };
});

app.post("/revoke", async (request) => {
  const { token } = request.body as { token: string };
  tokens.delete(token);
  return { revoked: true };
});

app.listen({ port: 3002, host: "0.0.0.0" });
console.log("Sample OAuth running on :3002");
