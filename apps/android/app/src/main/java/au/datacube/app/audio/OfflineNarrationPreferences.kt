package au.datacube.app.audio

import android.content.Context

/**
 * Device-private narration preferences. No account sync and no voice recordings.
 * A neural on-device voice backend can reuse these selection controls in a later slice.
 */
class OfflineNarrationPreferences(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "datacube_offline_narration", Context.MODE_PRIVATE
    )

    var voiceName: String
        get() = preferences.getString("voice_name", "").orEmpty()
        set(value) { preferences.edit().putString("voice_name", value).apply() }

    var speed: Float
        get() = preferences.getFloat("speed", 1.0f).coerceIn(0.7f, 1.4f)
        set(value) { preferences.edit().putFloat("speed", value.coerceIn(0.7f, 1.4f)).apply() }

    var pitch: Float
        get() = preferences.getFloat("pitch", 1.0f).coerceIn(0.8f, 1.2f)
        set(value) { preferences.edit().putFloat("pitch", value.coerceIn(0.8f, 1.2f)).apply() }
}
