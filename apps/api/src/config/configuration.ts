// apps/api/src/config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  evolution: {
    url: process.env.EVOLUTION_URL ?? 'http://2.25.139.166:8085',
    apiKey: process.env.EVOLUTION_API_KEY ?? '',
  },
});
