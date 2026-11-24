plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// URL frontend produksi: diatur saat build (-PBASE_URL=https://...), tanpa mengubah backend.
val baseUrl = (project.findProperty("BASE_URL") as String?) ?: "https://BELUM-DIISI.example.invalid"

android {
    namespace = "id.akulaku.socialhub"
    compileSdk = 35
    defaultConfig {
        applicationId = "id.akulaku.socialhub"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0-dev"
        buildConfigField("String", "BASE_URL", "\"${baseUrl.trimEnd('/')}\"")
    }
    buildFeatures { buildConfig = true }
    buildTypes {
        debug { isMinifyEnabled = false }
        release { isMinifyEnabled = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt")) }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
}
