import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import {
  resolveVpsSharedSecretForSigning,
  resolveVpsTicketOperation,
} from '../src/lib/server/vps-ticket-config';
import {
  isOriginAllowed,
  resolveAllowedOrigins,
  routeRequirementForPath,
  resolveVpsSharedSecret,
  verifyVpsTicket,
} from '../vps-ai-gateway/src/auth';

async function run(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

async function signTicket(input: {
  secret: string;
  sub?: string;
  plan?: string;
  feature?: string;
  featureKey?: string;
  route?: string;
  ticketId?: string;
  expiresAt?: number;
  omitTicketId?: boolean;
  omitExpiration?: boolean;
}) {
  const jwt = new SignJWT({
    sub: input.sub ?? 'user-1',
    plan: input.plan ?? 'pro',
    ...(input.feature !== undefined ? { feature: input.feature } : {}),
    ...(input.featureKey !== undefined ? { feature_key: input.featureKey } : {}),
    ...(input.route !== undefined ? { route: input.route } : {}),
    ...(input.omitTicketId ? {} : { ticket_id: input.ticketId ?? 'ticket-1' }),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('dcau-next')
    .setAudience('dcau-vps-ai-gateway')
    .setIssuedAt();

  if (!input.omitTicketId) {
    jwt.setJti(input.ticketId ?? 'ticket-1');
  }

  if (input.omitExpiration) {
    // No-op: this intentionally signs a structurally incomplete ticket.
  } else if (input.expiresAt) {
    jwt.setExpirationTime(input.expiresAt);
  } else {
    jwt.setExpirationTime('5m');
  }

  return jwt.sign(new TextEncoder().encode(input.secret));
}

const configuredSecret = 'configured-vps-shared-secret';

async function main() {
await run('production missing secret fails closed for ticket signing', () => {
  const resolved = resolveVpsSharedSecretForSigning({ NODE_ENV: 'production' });
  assert.equal(resolved.ok, false);
  if (!resolved.ok) {
    assert.equal(resolved.code, 'VPS_SHARED_SECRET_MISSING');
  }
});

await run('production does not use an insecure fallback secret', () => {
  const nextSecret = resolveVpsSharedSecretForSigning({ NODE_ENV: 'production' });
  const vpsSecret = resolveVpsSharedSecret({ NODE_ENV: 'production' });
  assert.equal(nextSecret.ok, false);
  assert.equal(vpsSecret.ok, false);
});

await run('explicit local development fallback is unavailable in production', () => {
  const resolved = resolveVpsSharedSecretForSigning({
    NODE_ENV: 'production',
    DCAU_ALLOW_INSECURE_DEV_VPS_SECRET: '1',
  });
  assert.equal(resolved.ok, false);
});

await run('valid AU Chat ticket is accepted for AU Chat route', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'au-chat',
    featureKey: 'au_chat',
    route: '/chat/au-chat',
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/chat/au-chat'),
  );
  assert.equal(verified?.userId, 'user-1');
  assert.equal(verified?.featureKey, 'au_chat');
  assert.equal(verified?.route, '/chat/au-chat');
});

await run('valid Global Chat ticket is accepted for Global Chat route', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'global-chat',
    featureKey: 'global_chat',
    route: '/chat/global-chat',
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/chat/global-chat'),
  );
  assert.equal(verified?.featureKey, 'global_chat');
});

await run('valid generator ticket is accepted for matching generator route', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'generate-practice-exam',
    featureKey: 'practice_exam_generation',
    route: '/generate/practice-exam',
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/generate/practice-exam'),
  );
  assert.equal(verified?.featureKey, 'practice_exam_generation');
});

await run('wrong route is rejected', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'au-chat',
    featureKey: 'au_chat',
    route: '/chat/au-chat',
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/generate/practice-exam'),
  );
  assert.equal(verified, null);
});

await run('wrong feature for route is rejected', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'global-chat',
    featureKey: 'global_chat',
    route: '/generate/knowledge',
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/generate/knowledge'),
  );
  assert.equal(verified, null);
});

await run('missing feature claim is rejected', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: undefined,
    featureKey: 'au_chat',
    route: '/chat/au-chat',
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/chat/au-chat'),
  );
  assert.equal(verified, null);
});

await run('expired ticket is rejected', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'au-chat',
    featureKey: 'au_chat',
    route: '/chat/au-chat',
    expiresAt: Math.floor(Date.now() / 1000) - 120,
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/chat/au-chat'),
  );
  assert.equal(verified, null);
});

await run('tampered ticket is rejected', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'au-chat',
    featureKey: 'au_chat',
    route: '/chat/au-chat',
  });
  const tampered = `${ticket.slice(0, -1)}x`;
  const verified = await verifyVpsTicket(
    tampered,
    configuredSecret,
    routeRequirementForPath('/chat/au-chat'),
  );
  assert.equal(verified, null);
});

await run('ticket without explicit expiry is rejected', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'au-chat',
    featureKey: 'au_chat',
    route: '/chat/au-chat',
    omitExpiration: true,
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/chat/au-chat'),
  );
  assert.equal(verified, null);
});

await run('ticket without unique id is rejected', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'au-chat',
    featureKey: 'au_chat',
    route: '/chat/au-chat',
    omitTicketId: true,
  });
  const verified = await verifyVpsTicket(
    ticket,
    configuredSecret,
    routeRequirementForPath('/chat/au-chat'),
  );
  assert.equal(verified, null);
});

await run('VPS verification rejects when shared secret is missing', async () => {
  const ticket = await signTicket({
    secret: configuredSecret,
    feature: 'au-chat',
    featureKey: 'au_chat',
    route: '/chat/au-chat',
  });
  const verified = await verifyVpsTicket(
    ticket,
    null,
    routeRequirementForPath('/chat/au-chat'),
  );
  assert.equal(verified, null);
});

await run('Next ticket operation map binds features to intended routes', () => {
  assert.deepEqual(resolveVpsTicketOperation('au-chat'), {
    requestFeature: 'au-chat',
    featureKey: 'au_chat',
    gatewayRoute: '/chat/au-chat',
    usageFeature: 'au-chat',
  });
  assert.equal(resolveVpsTicketOperation('global-chat')?.gatewayRoute, '/chat/global-chat');
  assert.equal(resolveVpsTicketOperation('generate-practice-exam')?.gatewayRoute, '/generate/practice-exam');
});

await run('production CORS requires explicit allowed origins and rejects wildcard', () => {
  assert.equal(resolveAllowedOrigins({ NODE_ENV: 'production' }).ok, false);
  assert.equal(resolveAllowedOrigins({ NODE_ENV: 'production', ALLOWED_ORIGINS: '*' }).ok, false);
});

await run('CORS origin matching is explicit and does not reflect arbitrary origins', () => {
  const resolved = resolveAllowedOrigins({
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://datacube.au,https://app.datacube.au',
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(isOriginAllowed('https://datacube.au', resolved.origins), true);
  assert.equal(isOriginAllowed('https://evil.example', resolved.origins), false);
  assert.equal(isOriginAllowed(undefined, resolved.origins), true);
});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
