package au.datacube.app.auth

import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.Postgrest

/**
 * Singleton Supabase client.
 *
 * URL and anon-key are injected at build time via BuildConfig — they come from
 * local.properties (dev) or CI secrets (CI/CD). They are non-secret public values;
 * the service-role key is never present in the app.
 */
object SupabaseClient {

    val client = createSupabaseClient(
        supabaseUrl = au.datacube.app.BuildConfig.SUPABASE_URL,
        supabaseKey = au.datacube.app.BuildConfig.SUPABASE_ANON_KEY
    ) {
        install(Auth) {
            scheme = "datacube"
            host = "auth-callback"
        }
        install(Postgrest)
    }

    val auth get() = client.auth
}
