plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "au.datacube.startupprobe"
    compileSdk = 35

    defaultConfig {
        applicationId = "au.datacube.startupprobe"
        minSdk = 35
        targetSdk = 35
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
