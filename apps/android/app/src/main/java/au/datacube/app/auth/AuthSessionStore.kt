package au.datacube.app.auth

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.authDataStore: DataStore<Preferences> by preferencesDataStore(name = "datacube_auth")

/**
 * Persists lightweight authentication state to DataStore.
 *
 * The Supabase-kt SDK persists the complete JWT session through
 * EncryptedSupabaseSessionManager. This store persists only lightweight display
 * metadata and must not be treated as the authenticated session.
 */
class AuthSessionStore(private val context: Context) {

    private val userIdKey = stringPreferencesKey("user_id")
    private val userEmailKey = stringPreferencesKey("user_email")

    val userId: Flow<String?> = context.authDataStore.data.map { it[userIdKey] }
    val userEmail: Flow<String?> = context.authDataStore.data.map { it[userEmailKey] }

    suspend fun persist(user: UserInfo?) {
        context.authDataStore.edit { prefs ->
            if (user == null) {
                prefs.remove(userIdKey)
                prefs.remove(userEmailKey)
            } else {
                prefs[userIdKey] = user.id
                prefs[userEmailKey] = user.email ?: ""
            }
        }
    }

    suspend fun clear() = persist(null)
}
