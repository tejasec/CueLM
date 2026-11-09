# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Preserve JS interface annotations
-keepattributes JavascriptInterface

# Keep our custom WebView JS bridge and all its public methods
-keep class com.cuelm.app.StorageBridge {
   public *;
}

# Keep MainActivity public methods (called from StorageBridge)
-keep class com.cuelm.app.MainActivity {
   public *;
}

# Ignore missing java.beans classes (referenced by Jackson but not available on Android)
-dontwarn java.beans.**

# AudioRecorder library rules
-keep class com.dimowner.audiorecorder.** { *; }
-dontwarn com.dimowner.audiorecorder.**

-keep class org.jaudiotagger.** { *; }
-dontwarn org.jaudiotagger.**

-keep class org.mp4parser.** { *; }
-dontwarn org.mp4parser.**

-dontwarn dagger.**
-dontwarn javax.inject.**
-dontwarn kotlin.coroutines.jvm.internal.**
-dontwarn kotlinx.parcelize.**
-dontwarn androidx.window.**
-dontwarn java.awt.**
-dontwarn javax.imageio.**
-dontwarn javax.swing.**
-dontwarn org.slf4j.**

