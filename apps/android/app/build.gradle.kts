import java.util.Properties

plugins {
 alias(libs.plugins.android.application)
 alias(libs.plugins.kotlin.android)
 alias(libs.plugins.kotlin.compose)
 alias(libs.plugins.kotlin.kapt)
 alias(libs.plugins.kotlin.serialization)
}

// Gradle does not automatically expose arbitrary local.properties entries as
// project properties. Read Android local.properties and ignored dotenv files
// explicitly so the APK never silently ships with blank Supabase credentials.
val androidBuildProperties = Properties()
listOf(
    rootProject.file("../../.env"),
    rootProject.file("../../.env.local"),
    rootProject.file("../../.env.development.local"),
    rootProject.file("local.properties")
).filter { it.isFile }.forEach { file ->
    file.inputStream().use { androidBuildProperties.load(it) }
}

fun configuredValue(vararg names: String): String? {
    for (name in names) {
        val value = providers.gradleProperty(name).orNull
            ?: androidBuildProperties.getProperty(name)
            ?: System.getenv(name)
        if (!value.isNullOrBlank()) {
            return value.trim().removeSurrounding("\"").removeSurrounding("'")
        }
    }
    return null
}

fun buildConfigLiteral(value: String): String = groovy.json.JsonOutput.toJson(value)

val supabaseUrl = configuredValue("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL") ?: ""
val supabaseAnonKey = configuredValue("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY") ?: ""
val authWebsiteUrl = configuredValue("AUTH_WEBSITE_URL") ?: "https://datacube-au.vercel.app"
// Public OAuth audience for the production project. Alternate environments can override it.
val googleWebClientId = configuredValue("GOOGLE_WEB_CLIENT_ID")
    ?: "414692638202-h7k7u85qaib8lvvt057bprrigmeirugi.apps.googleusercontent.com"
require(Regex("""[0-9]+-[a-zA-Z0-9_-]+[.]apps[.]googleusercontent[.]com""").matches(googleWebClientId)) {
    "GOOGLE_WEB_CLIENT_ID must be a Google OAuth client ID."
}

if (supabaseUrl.isNullOrBlank() || !supabaseUrl.startsWith("https://") || supabaseAnonKey.isNullOrBlank()) {
    throw GradleException(
        "DataCube AU Android build is missing Supabase configuration. Add SUPABASE_URL and " +
            "SUPABASE_ANON_KEY to apps/android/local.properties, or set NEXT_PUBLIC_SUPABASE_URL " +
            "and NEXT_PUBLIC_SUPABASE_ANON_KEY in the repository-root .env.local. Do not use a service-role key."
    )
}

android {
 namespace = "au.datacube.app"
 compileSdk = 35
 defaultConfig {
     applicationId = "au.datacube.app"
     minSdk = 26
     targetSdk = 35
     versionCode = 2
     versionName = "1.0.1"
     testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
     buildConfigField("String", "SUPABASE_URL", buildConfigLiteral(supabaseUrl))
     buildConfigField("String", "SUPABASE_ANON_KEY", buildConfigLiteral(supabaseAnonKey))
     buildConfigField("String", "AUTH_WEBSITE_URL", buildConfigLiteral(authWebsiteUrl))
     buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", buildConfigLiteral(googleWebClientId))
 }
 buildFeatures {
     compose = true
     buildConfig = true
 }
 compileOptions {
     sourceCompatibility = JavaVersion.VERSION_17
     targetCompatibility = JavaVersion.VERSION_17
 }
 kotlinOptions { jvmTarget = "17" }
}

kapt {
    arguments {
        arg("room.schemaLocation", "$projectDir/schemas")
    }
}

dependencies {
 implementation(platform(libs.compose.bom))
 implementation(libs.activity.compose)
 implementation(libs.compose.ui)
 implementation(libs.compose.animation)
 implementation(libs.compose.preview)
 implementation(libs.compose.material3)
 implementation(libs.compose.icons)
 implementation(libs.lifecycle.runtime)
 implementation(libs.lifecycle.viewmodel)
 implementation(libs.lifecycle.viewmodel.compose)
 implementation(libs.lifecycle.runtime.compose)
 implementation(libs.navigation.compose)
 implementation(libs.room.runtime)
 implementation(libs.room.ktx)
 implementation(libs.work.runtime)
 implementation(libs.datastore.preferences)
 implementation(libs.supabase.auth)
 implementation(libs.credentials)
 implementation(libs.credentials.play.services.auth)
 implementation(libs.googleid)
 implementation(libs.supabase.postgrest)
 implementation(libs.supabase.compose.auth)
 implementation(libs.ktor.client.android)
 implementation(libs.coil.compose)
 implementation(libs.splashscreen)
 implementation(libs.pdfium.android)
 kapt(libs.room.compiler)
 testImplementation(libs.junit)
 androidTestImplementation(libs.androidx.test.core)
 androidTestImplementation(libs.androidx.test.runner)
 androidTestImplementation(libs.androidx.test.ext.junit)
 androidTestImplementation(platform(libs.compose.bom))
 androidTestImplementation(libs.compose.ui.test)
 androidTestImplementation(libs.junit)
 androidTestImplementation(libs.pdfbox.android)
 debugImplementation(libs.compose.tooling)
 debugImplementation(libs.compose.ui.test.manifest)
}
