plugins {
 alias(libs.plugins.android.application)
 alias(libs.plugins.kotlin.android)
 alias(libs.plugins.kotlin.compose)
 alias(libs.plugins.kotlin.kapt)
 alias(libs.plugins.kotlin.serialization)
}
android {
 namespace = "au.datacube.app"
 compileSdk = 35
 defaultConfig {
     applicationId = "au.datacube.app"
     minSdk = 26
     targetSdk = 35
     versionCode = 1
     versionName = "1.0.0"
     testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
     // These are public client settings. The publishable key is designed to ship
     // in Android binaries; authorization remains enforced by Supabase Auth + RLS.
     // Local properties, Gradle properties, or environment variables can override
     // the production defaults without requiring CI secrets.
     val androidLocalProperties = java.util.Properties().apply {
         val propertiesFile = rootProject.file("local.properties")
         if (propertiesFile.isFile) {
             propertiesFile.inputStream().use { input -> load(input) }
         }
     }
     fun androidConfigValue(name: String, fallback: String): String {
         val candidates = listOf(
             project.findProperty(name) as? String,
             System.getenv(name),
             androidLocalProperties.getProperty(name)
         )
         return candidates.firstOrNull { !it.isNullOrBlank() } ?: fallback
     }
     val supabaseUrl = androidConfigValue(
         "SUPABASE_URL",
         "https://dhmukdeljiwvvwjdcxgn.supabase.co"
     )
     val supabasePublishableKey = androidConfigValue(
         "SUPABASE_PUBLISHABLE_KEY",
         "sb_publishable_6N4nuBJIaXzOVYYUXSzomA_R8TB1vc_"
     )
     val authWebsiteUrl = androidConfigValue(
         "AUTH_WEBSITE_URL",
         "https://datacube-au.vercel.app"
     )
     buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
     buildConfigField("String", "SUPABASE_PUBLISHABLE_KEY", "\"$supabasePublishableKey\"")
     buildConfigField("String", "AUTH_WEBSITE_URL", "\"$authWebsiteUrl\"")
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
 androidTestImplementation(libs.junit)
 androidTestImplementation(libs.pdfbox.android)
 debugImplementation(libs.compose.tooling)
}
