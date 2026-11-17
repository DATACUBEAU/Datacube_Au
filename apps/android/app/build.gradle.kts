plugins {
 alias(libs.plugins.android.application)
 alias(libs.plugins.kotlin.android)
 alias(libs.plugins.kotlin.compose)
 alias(libs.plugins.kotlin.kapt)
}
android {
 namespace = "au.datacube.app"
 compileSdk = 35
 defaultConfig { applicationId = "au.datacube.app"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0.0" }
 buildFeatures { compose = true }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
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
 implementation(libs.room.runtime)
 implementation(libs.room.ktx)
 implementation(libs.work.runtime)
 kapt(libs.room.compiler)
 debugImplementation(libs.compose.tooling)
}
