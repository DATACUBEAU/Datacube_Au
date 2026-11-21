package au.datacube.app.auth

import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.Postgrest
import au.datacube.app.DataCubeApp

/**
 * Singleton Supabase client.
 *
 * Project URL and publishable key are injected at build time via BuildConfig.
 * Publishable keys are public client identifiers. The service-role/secret key
 * is never present in the app.
 */
object SupabaseClient {

    val client = createSupabaseClient(
        supabaseUrl = au.datacube.app.BuildConfig.SUPABASE_URL,
        supabaseKey = au.datacube.app.BuildConfig.SUPABASE_ANON_KEY
    ) {
        install(Auth) {
            sessionManager = EncryptedSupabaseSessionManager(DataCubeApp.instance)
            autoLoadFromStorage = true
            autoSaveToStorage = true
            alwaysAutoRefresh = true
        }
        install(Postgrest)
    }

    val auth get() = client.auth
}
