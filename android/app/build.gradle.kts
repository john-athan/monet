import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The release key stays outside the repo (~/.config/monet-android). Its fingerprint is in the server's
// /.well-known/assetlinks.json: lose it and the app can no longer update itself, nor open full screen.
val releaseKeys = File(System.getProperty("user.home"), ".config/monet-android/keystore.properties")
    .takeIf { it.exists() }?.let { f -> Properties().apply { f.inputStream().use { load(it) } } }

android {
    namespace  = "dev.kaleve.monet"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.kaleve.monet"
        // One supported release, the current one: no version guards anywhere in the source.
        minSdk        = 36
        targetSdk     = 36
        versionCode   = 2
        versionName   = "0.2"
    }

    signingConfigs {
        if (releaseKeys != null) create("release") {
            storeFile     = File(releaseKeys.getProperty("storeFile"))
            storePassword = releaseKeys.getProperty("storePassword")
            keyAlias      = releaseKeys.getProperty("keyAlias")
            keyPassword   = releaseKeys.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled   = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    dependenciesInfo {
        includeInApk    = false
        includeInBundle = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
    buildFeatures { compose = true }
    sourceSets["main"].java.srcDir("src/main/kotlin")
    sourceSets["test"].java.srcDir("src/test/kotlin")
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(bom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.work:work-runtime:2.12.0")
    // Trusted Web Activity: the app shows the web app in Chrome's engine (BrowseActivity)
    implementation("androidx.browser:browser:1.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Everything under core/ is plain Kotlin: planner, resume, light, formats.
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    jvmToolchain(21)
}
