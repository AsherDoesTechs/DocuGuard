@echo off
"C:\\Users\\Asher Basco\\AppData\\Local\\Android\\Sdk\\cmake\\3.22.1\\bin\\cmake.exe" ^
  "-HC:\\Users\\Asher Basco\\Documents\\DocuGuard\\node_modules\\react-native\\ReactAndroid\\cmake-utils\\default-app-setup" ^
  "-DCMAKE_SYSTEM_NAME=Android" ^
  "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON" ^
  "-DCMAKE_SYSTEM_VERSION=24" ^
  "-DANDROID_PLATFORM=android-24" ^
  "-DANDROID_ABI=x86" ^
  "-DCMAKE_ANDROID_ARCH_ABI=x86" ^
  "-DANDROID_NDK=C:\\Users\\Asher Basco\\AppData\\Local\\Android\\Sdk\\ndk\\27.1.12297006" ^
  "-DCMAKE_ANDROID_NDK=C:\\Users\\Asher Basco\\AppData\\Local\\Android\\Sdk\\ndk\\27.1.12297006" ^
  "-DCMAKE_TOOLCHAIN_FILE=C:\\Users\\Asher Basco\\AppData\\Local\\Android\\Sdk\\ndk\\27.1.12297006\\build\\cmake\\android.toolchain.cmake" ^
  "-DCMAKE_MAKE_PROGRAM=C:\\Users\\Asher Basco\\AppData\\Local\\Android\\Sdk\\cmake\\3.22.1\\bin\\ninja.exe" ^
  "-DCMAKE_LIBRARY_OUTPUT_DIRECTORY=C:\\Users\\Asher Basco\\Documents\\DocuGuard\\android\\app\\build\\intermediates\\cxx\\RelWithDebInfo\\f442w126\\obj\\x86" ^
  "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=C:\\Users\\Asher Basco\\Documents\\DocuGuard\\android\\app\\build\\intermediates\\cxx\\RelWithDebInfo\\f442w126\\obj\\x86" ^
  "-DCMAKE_BUILD_TYPE=RelWithDebInfo" ^
  "-DCMAKE_FIND_ROOT_PATH=C:\\Users\\Asher Basco\\Documents\\DocuGuard\\android\\app\\.cxx\\RelWithDebInfo\\f442w126\\prefab\\x86\\prefab" ^
  "-BC:\\Users\\Asher Basco\\Documents\\DocuGuard\\android\\app\\.cxx\\RelWithDebInfo\\f442w126\\x86" ^
  -GNinja ^
  "-DANDROID_STL=c++_shared" ^
  "-DPROJECT_BUILD_DIR=C:\\Users\\Asher Basco\\Documents\\DocuGuard\\android\\app\\build" ^
  "-DPROJECT_ROOT_DIR=C:\\Users\\Asher Basco\\Documents\\DocuGuard\\android" ^
  "-DREACT_ANDROID_DIR=C:\\Users\\Asher Basco\\Documents\\DocuGuard\\node_modules\\react-native\\ReactAndroid" ^
  "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"
