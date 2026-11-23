package au.datacube.app.ui.theme

import android.content.Context

enum class ThemePreference { SYSTEM, LIGHT, DARK }

class ThemePreferenceStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("datacube_display", Context.MODE_PRIVATE)
    fun get(): ThemePreference = runCatching {
        ThemePreference.valueOf(prefs.getString("theme", ThemePreference.SYSTEM.name) ?: ThemePreference.SYSTEM.name)
    }.getOrDefault(ThemePreference.SYSTEM)
    fun set(value: ThemePreference) { prefs.edit().putString("theme", value.name).apply() }
}
