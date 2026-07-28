const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const missing = requiredEnv.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing required backend env vars: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(
  'Pipeline verification script is credential-safe. Implement local verification with env-provided credentials only.',
);

export {};
