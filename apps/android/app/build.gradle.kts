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
     // Supabase project values — injected from local.properties or CI secrets
     val supabaseUrl = project.findProperty("SUPABASE_URL") as String? ?: ""
     val supabaseAnonKey = project.findProperty("SUPABASE_ANON_KEY") as String? ?: ""
     val authWebsiteUrl = project.findProperty("AUTH_WEBSITE_URL") as String? ?: "https://datacube-au.vercel.app"
     buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
     buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
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
